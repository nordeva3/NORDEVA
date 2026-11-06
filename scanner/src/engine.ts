// Scan engine: orchestrates the pipeline layers and aggregates the verdict.
//
// Verdict rules (also documented in README — keep the two in sync):
//   dangerous : any critical finding (every confirmed signature is critical)
//   incomplete: otherwise, any file that could not be content-inspected
//               (unsupported/encrypted archive, unexpanded nested archive,
//               executable binary, oversize/truncated file, read errors)
//   warning   : otherwise, any high finding, >= 3 medium findings, or a
//               high obfuscation score on any file
//   safe      : otherwise
//
// A scan that could not look at something says so — it never rounds a
// partial inspection up to "safe".

import type {
  Finding,
  FileRecord,
  ScanLimits,
  ScanReport,
  SandboxBehavior,
} from "./types";
import { loadLimits } from "./types";
import { sha256Hex, looksLikeText, extOf, shannonEntropy } from "./util";
import {
  RULES_VERSION,
  EICAR_SHA256,
  TEXT_EXTS,
  EXECUTABLE_EXTS,
  EXECUTABLE_KINDS,
  MEDIA_KINDS,
  sniffKind,
  classifyDestination,
} from "./signatures";
import { expandArchive, type ExtractedItem } from "./archive";
import { analyzeTextFile, genericSignatureScan, newAnalysisCtx, type AnalysisCtx } from "./static";
import { parseManifest, analyzeManifest, queryOsv, type ManifestInfo } from "./deps";
import { runInSandbox, sandboxSkipReason } from "./sandbox";
import { hostOfUrl, isIpHost } from "./util";

export interface ScanOptions {
  fileName: string;
  expectedSha256?: string | null;
  limits?: ScanLimits;
  osvEnabled?: boolean;
}

export async function scanBuffer(buf: Buffer, opts: ScanOptions): Promise<ScanReport> {
  const started = Date.now();
  const limits = opts.limits ?? loadLimits();
  const sha = sha256Hex(buf);
  const report: ScanReport = {
    verdict: "incomplete",
    rules_version: RULES_VERSION,
    duration_ms: 0,
    sha256_match: opts.expectedSha256 ? sha === opts.expectedSha256 : true,
    size_bytes: buf.length,
    coverage: { entries_total: 0, files_total: 0, files_inspected: 0, files_skipped: 0 },
    files: [],
    findings: [],
    layers: {
      archive: { status: "ok", notes: [] },
      static: { status: "skipped", files_analyzed: 0 },
      signatures: { status: "ok", hits: [] },
      dependencies: { status: "ok", manifests: 0, issues: [] },
      sandbox: { status: "skipped", files_run: 0, behaviors: [] },
    },
    limits_hit: [],
  };

  const findings: Finding[] = [];
  const ctx: AnalysisCtx = newAnalysisCtx();

  // ---- Layer A: archive expansion ----------------------------------------
  const archive = await expandArchive(buf, opts.fileName, limits);
  report.layers.archive.notes = archive.notes;
  report.layers.archive.status = archive.anyFailure ? "failed" : archive.limited ? "limited" : "ok";
  report.coverage.entries_total = archive.entriesTotal;
  report.limits_hit.push(...archive.limitsHit);
  findings.push(...archive.findings);

  // ---- Per-file classification + static analysis --------------------------
  const works: Array<ProcessOutcome & { record: FileRecord }> = [];
  const manifests: ManifestInfo[] = [];
  let anyAstPartial = false;
  let anyStaticPartial = false;
  let staticAnalyzed = 0;

  for (const item of archive.items) {
    const work = await processItem(item, limits, ctx, findings, manifests);
    if (work.astPartial) anyAstPartial = true;
    if (work.staticPartial) anyStaticPartial = true;
    if (work.record.layers.some((l) => l.startsWith("static"))) staticAnalyzed++;
    works.push(work);
    report.files.push(work.record);
  }

  report.layers.static.files_analyzed = staticAnalyzed;
  report.layers.static.status =
    staticAnalyzed === 0 ? "skipped" : anyAstPartial || anyStaticPartial ? "partial" : "ok";

  // ---- Layer D: dependencies ----------------------------------------------
  report.layers.dependencies.manifests = manifests.length;
  for (const mf of manifests) {
    const { findings: depFindings, issues } = analyzeManifest(mf);
    findings.push(...depFindings);
    report.layers.dependencies.issues.push(...issues);
  }
  const osvOn = opts.osvEnabled ?? process.env.OSV_ENABLED === "1";
  if (manifests.length === 0) {
    report.layers.dependencies.status = "ok";
  } else if (!osvOn) {
    report.layers.dependencies.status = "disabled";
  } else {
    const osv = await queryOsv(manifests);
    if (osv === null) {
      report.layers.dependencies.status = "unavailable";
      report.layers.dependencies.issues.push({
        file: "(scanner)",
        message: "OSV vulnerability lookup failed or timed out; known-vulnerability status of pinned dependencies is unknown.",
        severity: "low",
      });
    } else {
      report.layers.dependencies.status = "ok";
      for (const hit of osv) {
        for (const vuln of hit.vulns.slice(0, 5)) {
          const msg = `Known vulnerability ${vuln.id} in ${hit.name}@${hit.version}${vuln.summary ? `: ${vuln.summary}` : ""}`;
          findings.push({ rule_id: "DEP_OSV_VULN", severity: "high", file: hit.file, line: null, message: msg });
          report.layers.dependencies.issues.push({ file: hit.file, message: msg, severity: "high" });
        }
      }
    }
  }

  // ---- Layer E: sandbox ----------------------------------------------------
  const sandbox = await runSandboxLayer(works, limits, findings);
  report.layers.sandbox = sandbox;

  // ---- Dedupe + signatures --------------------------------------------------
  const deduped = dedupeFindings(findings);
  report.findings = sortFindings(deduped);
  const hits: string[] = [];
  for (const f of report.findings) {
    if (f.signature && !hits.includes(f.rule_id)) hits.push(f.rule_id);
  }
  report.layers.signatures.hits = hits;

  // ---- Coverage + verdict ---------------------------------------------------
  report.coverage.files_total = report.files.length;
  report.coverage.files_inspected = report.files.filter((f) => f.inspected).length;
  report.coverage.files_skipped = report.coverage.files_total - report.coverage.files_inspected;
  report.verdict = aggregateVerdict(report);
  report.duration_ms = Date.now() - started;
  return report;
}

function aggregateVerdict(report: ScanReport): ScanReport["verdict"] {
  if (report.findings.some((f) => f.severity === "critical")) return "dangerous";
  if (report.files.some((f) => !f.inspected)) return "incomplete";
  const mediums = report.findings.filter((f) => f.severity === "medium").length;
  if (report.findings.some((f) => f.severity === "high") || mediums >= 3) return "warning";
  return "safe";
}

interface ProcessOutcome {
  record: FileRecord;
  astPartial: boolean;
  staticPartial: boolean;
  text?: string;
  ext: string;
  buf: Buffer | null;
}

async function processItem(
  item: ExtractedItem,
  limits: ScanLimits,
  ctx: AnalysisCtx,
  findings: Finding[],
  manifests: ManifestInfo[],
): Promise<ProcessOutcome & { record: FileRecord }> {
  const ext = extOf(item.path);
  const base: ProcessOutcome = {
    record: { path: item.path, size: item.size, type: "unknown", inspected: false, layers: [] },
    astPartial: false,
    staticPartial: false,
    ext,
    buf: item.buf,
  };
  const rec = base.record;

  if (item.containerExpanded) {
    rec.type = "archive";
    rec.inspected = true;
    rec.layers = ["archive"];
    return base;
  }
  if (!item.buf) {
    rec.type = ext || "unknown";
    rec.skipped_reason = item.noContentReason ?? "content unavailable";
    return base;
  }
  const buf = item.buf;
  const kind = sniffKind(buf);
  rec.type = kind !== "unknown" ? kind : ext || "unknown";

  // EICAR by file hash — catches the test file in any container/encoding.
  if (sha256Hex(buf) === EICAR_SHA256) {
    findings.push({
      rule_id: "SIG_EICAR",
      severity: "critical",
      file: item.path,
      line: null,
      message: "File hash matches the EICAR anti-malware test file.",
      signature: true,
    });
  }

  if (item.noContentReason) {
    // e.g. nested archive beyond depth: present but deliberately unopened.
    rec.skipped_reason = item.noContentReason;
    return base;
  }
  if (item.truncated) {
    rec.skipped_reason = "file exceeds the per-entry size cap; only a prefix could be read, so it was not fully inspected";
    return base;
  }
  if (kind === "7z" || kind === "rar") {
    rec.skipped_reason = `${kind} archives cannot be opened by this scanner; contents not inspected`;
    return base;
  }

  const isExecutable = EXECUTABLE_KINDS.has(kind) || (EXECUTABLE_EXTS.has(ext) && kind !== "zip");
  if (isExecutable) {
    rec.layers = ["strings"];
    rec.skipped_reason = "executable/binary content is never executed by this scanner and is not fully content-inspected (string scan only)";
    findings.push(...stringScan(item.path, buf, ctx));
    return base;
  }

  if (MEDIA_KINDS.has(kind)) {
    rec.inspected = true;
    rec.layers = ["fingerprint", "strings"];
    const entropy = shannonEntropy(buf);
    if (entropy > 7.9 && buf.length > 64 * 1024) {
      findings.push({
        rule_id: "MEDIA_HIGH_ENTROPY",
        severity: "low",
        file: item.path,
        line: null,
        message: `Media file has unusually high entropy (${entropy.toFixed(2)} bits/byte) — could indicate encrypted/compressed payload appended to the media data.`,
      });
    }
    const pkAt = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 4);
    if (pkAt > 0) {
      findings.push({
        rule_id: "MEDIA_POLYGLOT_ZIP",
        severity: "medium",
        file: item.path,
        line: null,
        message: "Media file contains an embedded ZIP archive after its image/audio data (polyglot file). The embedded archive's contents were not separately extracted.",
      });
    }
    findings.push(...stringScan(item.path, buf, ctx));
    return base;
  }

  const textish = TEXT_EXTS.has(ext) || looksLikeText(buf);
  if (textish) {
    if (buf.length > limits.textAnalysisCap) {
      rec.layers = ["static-partial"];
      rec.skipped_reason = `text file exceeds the static-analysis cap (${limits.textAnalysisCap} bytes); only the first part was scanned`;
      base.staticPartial = true;
      const text = buf.subarray(0, limits.textAnalysisCap).toString("utf8");
      base.text = text;
      const { findings: f } = analyzeTextFile(item.path, text, ctx);
      findings.push(...f);
      return base;
    }
    const text = buf.toString("utf8");
    base.text = text;
    rec.inspected = true;
    const { findings: f, astPartial } = analyzeTextFile(item.path, text, ctx);
    findings.push(...f);
    base.astPartial = astPartial;
    rec.layers = astPartial ? ["static", "ast-fallback"] : ["static"];
    const mf = parseManifest(item.path, text);
    if (mf) manifests.push(mf);
    return base;
  }

  // Unknown binary: fingerprinted + string-scanned, but NOT content-inspected.
  rec.layers = ["strings"];
  rec.skipped_reason = "unrecognized binary format; fingerprinted and string-scanned only, not content-inspected";
  findings.push(...stringScan(item.path, buf, ctx));
  return base;
}

/** Extract printable strings from a binary and run the signature/URL scans. */
function stringScan(filePath: string, buf: Buffer, ctx: AnalysisCtx): Finding[] {
  const cap = 2 * 1024 * 1024;
  const sample = buf.length > cap ? buf.subarray(0, cap) : buf;
  const text = sample.toString("latin1");
  const strings: string[] = [];
  const re = /[\x20-\x7e]{6,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    strings.push(m[0]);
    if (strings.length > 20000) break;
  }
  const joined = strings.join("\n");
  const out = genericSignatureScan(filePath, joined);
  for (const f of out) f.line = null; // line numbers inside binaries are meaningless
  return out;
}

// ---------------------------------------------------------------------------
// Sandbox orchestration
// ---------------------------------------------------------------------------

async function runSandboxLayer(
  works: Array<ProcessOutcome & { record: FileRecord }>,
  limits: ScanLimits,
  findings: Finding[],
): Promise<ScanReport["layers"]["sandbox"]> {
  const behaviors: SandboxBehavior[] = [];
  let filesRun = 0;
  let attempted = 0;
  let skipRecorded = 0;

  for (const work of works) {
    const ext = work.ext;
    if (!["js", "mjs", "cjs"].includes(ext)) continue;
    if (!work.buf || work.record.skipped_reason) continue;
    const source = work.text ?? work.buf.toString("utf8");
    const skip = sandboxSkipReason(source, work.buf.length, limits.sandboxMaxBytes);
    if (skip) {
      if (skipRecorded < 50) {
        behaviors.push({ file: work.record.path, kind: "skipped", detail: skip });
        skipRecorded++;
      }
      continue;
    }
    attempted++;
    const outcome = await runInSandbox(work.record.path, source);
    filesRun++;
    behaviors.push(...outcome.behaviors);
    findings.push(...sandboxFindings(work.record.path, outcome.behaviors));
    work.record.layers.push("sandbox");
  }

  return {
    status: attempted > 0 || behaviors.length > 0 ? "ok" : "skipped",
    files_run: filesRun,
    behaviors,
  };
}

function sandboxFindings(file: string, behaviors: SandboxBehavior[]): Finding[] {
  const out: Finding[] = [];
  const network = behaviors.filter((b) => b.kind === "network");
  const cookie = behaviors.some((b) => b.kind === "cookie-read" || b.kind === "cookie-write");
  const storageToken = behaviors.some(
    (b) => b.kind === "storage-read" && /token|auth|jwt|session|password|secret/i.test(b.detail),
  );

  for (const n of network) {
    const url = n.detail.replace(/^(fetch|xhr|websocket|sendBeacon)\s+\S*\s*/i, "").trim() || n.detail;
    const dest = classifyDestination(n.detail);
    if (dest.cls === "webhook-exfil") {
      out.push({
        rule_id: "SANDBOX_EXFIL_ATTEMPT",
        severity: "critical",
        file,
        line: null,
        message: `Sandbox observed the code actually attempting to send data to a known stealer exfiltration endpoint (${n.detail}).`,
        signature: true,
      });
    } else if (isIpHost(hostOfUrl(url))) {
      out.push({
        rule_id: "SANDBOX_NETWORK_IP",
        severity: "high",
        file,
        line: null,
        message: `Sandbox observed a network attempt to a literal IP address (${n.detail}).`,
      });
    }
  }
  if ((cookie || storageToken) && network.length > 0) {
    out.push({
      rule_id: "SANDBOX_EXFIL_COMBO",
      severity: "critical",
      file,
      line: null,
      message: "Sandbox observed credential-store access AND a network send at runtime — active credential exfiltration behaviour.",
      signature: true,
    });
  }
  if (behaviors.some((b) => b.kind === "eval" || b.kind === "function-ctor")) {
    out.push({
      rule_id: "SANDBOX_EVAL",
      severity: "medium",
      file,
      line: null,
      message: "Sandbox observed runtime use of eval/Function constructor (dynamic code execution at runtime).",
    });
  }
  if (behaviors.some((b) => b.kind === "clipboard-read")) {
    out.push({
      rule_id: "SANDBOX_CLIPBOARD",
      severity: "medium",
      file,
      line: null,
      message: "Sandbox observed a clipboard read at runtime.",
    });
  }
  if (behaviors.some((b) => b.kind === "listener" && /keydown|keyup|keypress/.test(b.detail))) {
    out.push({
      rule_id: "SANDBOX_KEYLISTENER",
      severity: "medium",
      file,
      line: null,
      message: "Sandbox observed registration of a global keyboard listener at runtime.",
    });
  }
  const timeout = behaviors.find((b) => b.kind === "timeout");
  if (timeout) {
    out.push({
      rule_id: "SANDBOX_NOTE",
      severity: "info",
      file,
      line: null,
      message: `Sandbox note: ${timeout.detail}. A timeout is recorded honestly; it is not treated as proof of malice or of safety.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report helpers shared with the HTTP layer
// ---------------------------------------------------------------------------

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const eicarFiles = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    // EICAR is detected twice per file by design (content signature + whole-
    // file hash). Those are one detection, not two — keep only the first.
    if (f.rule_id === "SIG_EICAR") {
      const fk = f.file ?? "";
      if (eicarFiles.has(fk)) continue;
      eicarFiles.add(fk);
    }
    const key = `${f.rule_id}|${f.file ?? ""}|${f.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    return (a.file ?? "").localeCompare(b.file ?? "");
  });
}

export function primarySignature(report: ScanReport): string | null {
  return report.layers.signatures.hits[0] ?? report.findings.find((f) => f.severity === "critical")?.rule_id ?? null;
}

/** Minimal report used when the scan could not even start on the content. */
export function skeletonReport(partial: Partial<ScanReport> & { size_bytes: number }): ScanReport {
  return {
    verdict: "incomplete",
    rules_version: RULES_VERSION,
    duration_ms: 0,
    sha256_match: true,
    coverage: { entries_total: 0, files_total: 0, files_inspected: 0, files_skipped: 0 },
    files: [],
    findings: [],
    layers: {
      archive: { status: "failed", notes: [] },
      static: { status: "skipped", files_analyzed: 0 },
      signatures: { status: "skipped", hits: [] },
      dependencies: { status: "ok", manifests: 0, issues: [] },
      sandbox: { status: "skipped", files_run: 0, behaviors: [] },
    },
    limits_hit: [],
    ...partial,
  };
}
