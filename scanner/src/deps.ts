// Dependency analysis layer.
//
// Checks the supply chain of an uploaded product:
//  - dependencies fetched from git/HTTP(S) URLs instead of a registry
//    (attacker-controlled code, unreviewable) — high.
//  - install hooks (preinstall/install/postinstall) that run shell commands
//    or reach the network — the classic npm supply-chain attack vector.
//  - a short list of notorious package names, and edit-distance-1 typosquats
//    of the most-installed packages.
//  - optionally, live vulnerability data from OSV (https://osv.dev) when
//    OSV_ENABLED=1. Network failure degrades the layer to "unavailable";
//    it never fails the scan.

import type { DepIssue, Finding, Severity } from "./types";
import { levenshtein } from "./util";

// Notorious names: packages that are malicious by design or were the centre
// of well-documented supply-chain incidents. This list is intentionally
// short and illustrative — it is NOT a substitute for a live advisory feed
// (enable OSV for that). Documented in README.
const KNOWN_BAD_NPM: Record<string, string> = {
  "discord.js-selfbot": "Self-botting library used to hijack Discord accounts; banned from legitimate use.",
  "noblox.js-proxied": "Known credential-stealing fork targeting Roblox users.",
  "discord.js-token-grabber": "Purpose-built Discord token stealer.",
  "steam-token-grabber": "Purpose-built account token stealer.",
};

const TOP_NPM = [
  "react", "react-dom", "lodash", "express", "axios", "chalk", "commander",
  "debug", "async", "moment", "uuid", "webpack", "typescript", "eslint",
  "prettier", "jest", "mocha", "underscore", "ramda", "yargs", "inquirer",
  "glob", "fs-extra", "dotenv", "cors", "morgan", "mongoose", "socket.io",
  "bluebird", "request",
];

const TOP_PYPI = [
  "requests", "numpy", "pandas", "flask", "django", "boto3", "pillow",
  "lxml", "cryptography", "pyyaml", "setuptools", "pip", "wheel", "urllib3",
  "certifi", "idna", "charset-normalizer", "python-dateutil", "pytz",
  "six", "attrs", "click", "jinja2", "markupsafe", "werkzeug", "sqlalchemy",
  "psycopg2", "redis", "celery",
];

export interface ManifestInfo {
  path: string;
  kind: "npm" | "pypi" | "composer" | "gemfile";
  deps: Array<{ name: string; spec: string }>;
  hooks: Array<{ name: string; command: string }>;
}

export function parseManifest(path: string, text: string): ManifestInfo | null {
  // Display paths join nested members with "!" — the manifest is the last segment.
  const base = path.split(/[\\/!]/).pop()?.toLowerCase() ?? "";
  if (base === "package.json") {
    try {
      const json = JSON.parse(text) as Record<string, any>;
      const deps: ManifestInfo["deps"] = [];
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const obj = json[section];
        if (obj && typeof obj === "object") {
          for (const [name, spec] of Object.entries(obj)) deps.push({ name, spec: String(spec) });
        }
      }
      const hooks: ManifestInfo["hooks"] = [];
      const scripts = json.scripts;
      if (scripts && typeof scripts === "object") {
        for (const name of ["preinstall", "install", "postinstall", "prepare"]) {
          if (typeof scripts[name] === "string") hooks.push({ name, command: scripts[name] });
        }
      }
      return { path, kind: "npm", deps, hooks };
    } catch {
      return { path, kind: "npm", deps: [], hooks: [] };
    }
  }
  if (base === "requirements.txt" || base === "requirements-dev.txt") {
    const deps: ManifestInfo["deps"] = [];
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("-")) continue;
      const m = /^([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(line);
      if (m) deps.push({ name: m[1].toLowerCase(), spec: (m[2] ?? "").trim() });
      if (/^(git\+|https?:\/\/)/.test(line)) deps.push({ name: line.slice(0, 60), spec: line });
    }
    return { path, kind: "pypi", deps, hooks: [] };
  }
  if (base === "composer.json") {
    try {
      const json = JSON.parse(text) as Record<string, any>;
      const deps: ManifestInfo["deps"] = [];
      for (const section of ["require", "require-dev"]) {
        const obj = json[section];
        if (obj && typeof obj === "object") {
          for (const [name, spec] of Object.entries(obj)) {
            if (name !== "php") deps.push({ name, spec: String(spec) });
          }
        }
      }
      const hooks: ManifestInfo["hooks"] = [];
      const scripts = json.scripts;
      if (scripts && typeof scripts === "object") {
        for (const name of ["pre-install-cmd", "post-install-cmd", "pre-update-cmd", "post-update-cmd"]) {
          const v = scripts[name];
          if (typeof v === "string") hooks.push({ name, command: v });
          if (Array.isArray(v)) for (const c of v) if (typeof c === "string") hooks.push({ name, command: c });
        }
      }
      return { path, kind: "composer", deps, hooks };
    } catch {
      return { path, kind: "composer", deps: [], hooks: [] };
    }
  }
  if (base === "gemfile") {
    const deps: ManifestInfo["deps"] = [];
    const hooks: ManifestInfo["hooks"] = [];
    for (const line of text.split("\n")) {
      const m = /^\s*gem\s+['"]([^'"]+)['"]/.exec(line);
      if (m) deps.push({ name: m[1], spec: line.includes("git") ? "git" : "" });
      if (/git\s*:/.test(line) || /:git\s*=>/.test(line)) {
        deps.push({ name: `git-source:${line.trim().slice(0, 50)}`, spec: "git+" });
      }
    }
    return { path, kind: "gemfile", deps, hooks };
  }
  return null;
}

const REMOTE_SPEC_RE = /^(git\+|git:|github:|https?:\/\/|file:)/;
const HOOK_NETWORK_RE = /(curl|wget|https?:\/\/|node\s+-e|fetch\s*\(|powershell|certutil|bitsadmin)/i;
const HOOK_SHELL_RE = /(curl|wget|\bsh\b|\bbash\b|powershell|cmd\.exe|\bnode\b|\bpython)/i;

export function analyzeManifest(info: ManifestInfo): { findings: Finding[]; issues: DepIssue[] } {
  const findings: Finding[] = [];
  const issues: DepIssue[] = [];
  const add = (rule_id: string, severity: Severity, message: string) => {
    findings.push({ rule_id, severity, file: info.path, line: null, message });
    issues.push({ file: info.path, message, severity });
  };

  for (const dep of info.deps) {
    if (REMOTE_SPEC_RE.test(dep.spec) || REMOTE_SPEC_RE.test(dep.name)) {
      add(
        "DEP_REMOTE_URL",
        "high",
        `Dependency "${dep.name}" is fetched from a non-registry source (${dep.spec.slice(0, 80)}). Registry packages are signed and reviewable; direct git/HTTP fetches are not.`,
      );
    }
    if (info.kind === "npm" && KNOWN_BAD_NPM[dep.name]) {
      add("DEP_KNOWN_BAD", "critical", `Dependency "${dep.name}" is a known malicious/abusive package: ${KNOWN_BAD_NPM[dep.name]}`);
    }
    const topList = info.kind === "npm" ? TOP_NPM : info.kind === "pypi" ? TOP_PYPI : null;
    if (topList && !topList.includes(dep.name)) {
      for (const top of topList) {
        if (levenshtein(dep.name.toLowerCase(), top) === 1) {
          add("DEP_TYPOSQUAT", "medium", `Dependency "${dep.name}" differs by one character from the popular package "${top}" — possible typosquat.`);
          break;
        }
      }
    }
  }

  for (const hook of info.hooks) {
    if (HOOK_NETWORK_RE.test(hook.command)) {
      add(
        "DEP_INSTALL_HOOK_REMOTE",
        "critical",
        `Install hook "${hook.name}" runs a command that reaches the network or downloads code: \`${hook.command.slice(0, 120)}\`. This is the leading npm supply-chain attack pattern.`,
      );
    } else if (HOOK_SHELL_RE.test(hook.command)) {
      add(
        "DEP_INSTALL_HOOK",
        "high",
        `Install hook "${hook.name}" runs shell commands at install time: \`${hook.command.slice(0, 120)}\`. Buyers' machines execute this automatically on npm install.`,
      );
    } else {
      add(
        "DEP_INSTALL_HOOK",
        "medium",
        `Install hook "${hook.name}" present: \`${hook.command.slice(0, 120)}\`. Install hooks run arbitrary code on install and deserve manual review.`,
      );
    }
  }
  return { findings, issues };
}

interface OsvVuln {
  id: string;
  summary?: string;
}

/** Query OSV for pinned npm/pypi deps. Returns null on any failure. */
export async function queryOsv(
  manifests: ManifestInfo[],
  timeoutMs = 4000,
): Promise<Array<{ file: string; name: string; version: string; vulns: OsvVuln[] }> | null> {
  const queries: Array<{ package: { name: string; ecosystem: string }; version: string }> = [];
  const owners: Array<{ file: string; name: string; version: string }> = [];
  for (const mf of manifests) {
    const ecosystem = mf.kind === "npm" ? "npm" : mf.kind === "pypi" ? "PyPI" : null;
    if (!ecosystem) continue;
    for (const dep of mf.deps) {
      const version = dep.spec.replace(/^[\^~>=<\s]*/, "").trim();
      if (!/^\d+\.\d+\.\d+(?:[-.][\w.]+)?$/.test(version)) continue; // only exact pins are queryable
      queries.push({ package: { name: dep.name, ecosystem }, version });
      owners.push({ file: mf.path, name: dep.name, version });
    }
  }
  if (queries.length === 0) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ vulns?: OsvVuln[] }> };
    const out: Array<{ file: string; name: string; version: string; vulns: OsvVuln[] }> = [];
    (data.results ?? []).forEach((r, i) => {
      if (r.vulns && r.vulns.length > 0) {
        out.push({ ...owners[i], vulns: r.vulns });
      }
    });
    return out;
  } catch {
    return null;
  }
}
