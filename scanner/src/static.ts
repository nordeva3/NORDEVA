// Static analysis layer.
//
// Design notes:
//  - JS/TS files are parsed with acorn and inspected as an AST; when the
//    syntax is beyond acorn (TS types, JSX) we fall back to regex rules and
//    the caller marks the AST layer "partial" for that file. A parse failure
//    never means "clean" — the regex layer still runs.
//  - Single weak signals (one eval, one cookie read) are medium/low.
//    Severity comes from COMBINATIONS that match real stealer/loader
//    behaviour: credential-store access + a network send in the same file,
//    or a base64 decode flowing toward a code-execution sink, are critical
//    confirmed patterns.
//  - Every text file also passes the generic signature scan (EICAR, webshell
//    cores, miners, stealer exfil endpoints, reverse shells).

import * as acorn from "acorn";
import type { Finding } from "./types";
import { lineOf, snippetAt, textEntropy, hostOfUrl, isIpHost } from "./util";
import {
  EICAR_STRING,
  WEBSHELL_SIGNATURES,
  MINER_PATTERNS,
  classifyDestination,
} from "./signatures";
import { analyzePhp, analyzePython, analyzeShell, analyzeHtml } from "./langrules";

export interface AnalysisCtx {
  /** Global cap on URL-inventory info findings (avoid report floods). */
  urlFindings: number;
  urlCap: number;
}

export function newAnalysisCtx(): AnalysisCtx {
  return { urlFindings: 0, urlCap: 25 };
}

export interface TextAnalysis {
  findings: Finding[];
  /** True when the JS AST layer could not run and regex fallback was used. */
  astPartial: boolean;
}

export type Lang = "js" | "php" | "python" | "shell" | "html" | "text";

export function detectLang(path: string): Lang {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)) return "js";
  if (ext === "php") return "php";
  if (ext === "py") return "python";
  if (["sh", "bash", "zsh", "ps1", "bat", "cmd"].includes(ext)) return "shell";
  if (["html", "htm", "svg", "xml"].includes(ext)) return "html";
  return "text";
}

export function analyzeTextFile(path: string, text: string, ctx: AnalysisCtx): TextAnalysis {
  const findings: Finding[] = [];
  findings.push(...genericSignatureScan(path, text));
  findings.push(...urlInventory(path, text, ctx));
  const lang = detectLang(path);
  let astPartial = false;
  switch (lang) {
    case "js": {
      const r = analyzeJs(path, text);
      findings.push(...r.findings);
      astPartial = r.astPartial;
      break;
    }
    case "php":
      findings.push(...analyzePhp(path, text));
      break;
    case "python":
      findings.push(...analyzePython(path, text));
      break;
    case "shell":
      findings.push(...analyzeShell(path, text));
      break;
    case "html":
      findings.push(...analyzeHtml(path, text));
      break;
    default:
      break;
  }
  return { findings, astPartial };
}

// ---------------------------------------------------------------------------
// Generic signature scan (all text files)
// ---------------------------------------------------------------------------

const REVERSE_SHELL_RES: RegExp[] = [
  /\/dev\/tcp\/\d{1,3}(?:\.\d{1,3}){3}\/\d+/,
  /bash\s+-i\s*>&\s*\/dev\/tcp\//,
  /\bnc(?:at)?\b[^\n|;]{0,60}\s-e\s+\S+/,
  /\bsocat\b[^\n]{0,80}\bexec:/i,
  /python\d?\s+-c\s+["'][^"']*socket[^"']*dup2/s,
];

const DOWNLOAD_EXEC_RES: RegExp[] = [
  /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/,
  /\bInvoke-Expression\b[^\n]{0,200}DownloadString/i,
  /\bIEX\b[^\n]{0,120}DownloadString/i,
];

export function genericSignatureScan(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const pushAt = (
    rule_id: string,
    severity: Finding["severity"],
    idx: number,
    message: string,
    signature = false,
  ) => {
    out.push({
      rule_id,
      severity,
      file: path,
      line: lineOf(text, idx),
      message,
      snippet: snippetAt(text, idx),
      ...(signature ? { signature: true } : {}),
    });
  };

  const eicarIdx = text.indexOf(EICAR_STRING);
  if (eicarIdx >= 0) {
    pushAt("SIG_EICAR", "critical", eicarIdx, "EICAR anti-malware test file signature present.", true);
  }
  for (const sig of WEBSHELL_SIGNATURES) {
    const idx = text.indexOf(sig.needle);
    if (idx >= 0) {
      pushAt("SIG_WEBSHELL_NAME", "critical", idx, `Known webshell signature: ${sig.family} ("${sig.needle}").`, true);
    }
  }
  for (const miner of MINER_PATTERNS) {
    const m = miner.re.exec(text);
    if (m) pushAt("SIG_MINER", "critical", m.index, `Cryptominer indicator: ${miner.label}.`, true);
  }
  // Stealer exfiltration endpoints anywhere in text.
  const discord = /discord(?:app)?\.com\/api\/webhooks\/[\w-]+/i.exec(text);
  if (discord) {
    pushAt("EXFIL_DISCORD_WEBHOOK", "critical", discord.index, "Discord webhook URL embedded in code — the standard exfiltration channel for credential stealers.", true);
  }
  const telegram = /api\.telegram\.org\/bot[\w:-]+/i.exec(text);
  if (telegram) {
    pushAt("EXFIL_TELEGRAM_BOT", "critical", telegram.index, "Telegram Bot API URL with embedded bot token — common stealer exfiltration channel.", true);
  }
  for (const re of REVERSE_SHELL_RES) {
    const m = re.exec(text);
    if (m) pushAt("REVERSE_SHELL", "critical", m.index, "Reverse-shell pattern (interactive shell bound to a network socket).", true);
  }
  for (const re of DOWNLOAD_EXEC_RES) {
    const m = re.exec(text);
    if (m) pushAt("DOWNLOAD_EXEC", "critical", m.index, "Download-and-execute pattern (remote code fetched and run immediately).", true);
  }
  return out;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]`\\]+/g;

function urlInventory(path: string, text: string, ctx: AnalysisCtx): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    if (ctx.urlFindings >= ctx.urlCap) break;
    if (classifyDestination(url).cls === "webhook-exfil") continue; // already a critical finding
    const host = hostOfUrl(url);
    ctx.urlFindings++;
    if (isIpHost(host)) {
      out.push({
        rule_id: "URL_LITERAL_IP",
        severity: "medium",
        file: path,
        line: lineOf(text, m.index ?? 0),
        message: `Network reference to a literal IP address (${host}) — legitimate products almost always use domain names; raw IPs are typical of C2/exfil endpoints.`,
        snippet: snippetAt(text, m.index ?? 0),
      });
    } else {
      out.push({
        rule_id: "URL_EXTERNAL",
        severity: "info",
        file: path,
        line: lineOf(text, m.index ?? 0),
        message: `External URL referenced: ${url.slice(0, 120)}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript AST analysis
// ---------------------------------------------------------------------------

function literalString(node: any): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && Array.isArray(node.expressions) && node.expressions.length === 0) {
    return node.quasis.map((q: any) => q.value?.cooked ?? "").join("");
  }
  return null;
}

function memberProp(node: any): string | null {
  if (!node || node.type !== "MemberExpression") return null;
  const p = node.property;
  if (!p) return null;
  if (p.type === "Identifier") return p.name;
  if (p.type === "Literal" && typeof p.value === "string") return p.value;
  return null;
}

function objectName(node: any): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return memberProp(node);
  return null;
}

function walk(node: any, cb: (n: any) => void): void {
  if (!node || typeof node.type !== "string") return;
  cb(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") walk(c, cb);
    } else if (v && typeof v.type === "string") {
      walk(v, cb);
    }
  }
}

const NETWORK_CALLEES = new Set(["fetch"]);
const TOKEN_KEY_RE = /token|auth|jwt|session|passwd|password|secret|credential/i;

interface JsFacts {
  cookieLines: number[];
  storageTokenLines: number[];
  networkCalls: Array<{ url: string | null; line: number; via: string }>;
  evalLines: number[];
  functionCtorLines: number[];
  childProcessLines: number[];
  vmLines: number[];
  fsDestructiveLines: number[];
  keyListenerLines: number[];
  clipboardLines: number[];
  passwordSelectorLines: number[];
  decodeLines: number[]; // atob / Buffer.from(..., 'base64')
  longBase64: Array<{ line: number; len: number }>;
  sinkLines: number[]; // innerHTML assignment / document.write
  bigStringArrays: number;
}

export function analyzeJs(path: string, text: string): TextAnalysis {
  let ast: any = null;
  for (const sourceType of ["module", "script"] as const) {
    try {
      ast = acorn.parse(text, {
        ecmaVersion: "latest",
        sourceType,
        locations: true,
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true,
      });
      break;
    } catch {
      ast = null;
    }
  }
  if (!ast) {
    // TS types / JSX or genuinely broken syntax: regex fallback, flagged partial.
    return { findings: analyzeJsRegex(path, text), astPartial: true };
  }

  const facts: JsFacts = {
    cookieLines: [],
    storageTokenLines: [],
    networkCalls: [],
    evalLines: [],
    functionCtorLines: [],
    childProcessLines: [],
    vmLines: [],
    fsDestructiveLines: [],
    keyListenerLines: [],
    clipboardLines: [],
    passwordSelectorLines: [],
    decodeLines: [],
    longBase64: [],
    sinkLines: [],
    bigStringArrays: 0,
  };

  walk(ast, (node) => {
    const line: number = node.loc?.start?.line ?? 0;
    switch (node.type) {
      case "ImportDeclaration": {
        const src = typeof node.source?.value === "string" ? node.source.value : "";
        if (src === "child_process") facts.childProcessLines.push(line);
        if (src === "vm") facts.vmLines.push(line);
        break;
      }
      case "VariableDeclarator": {
        // const x = require('child_process') style
        const init = node.init;
        if (init?.type === "CallExpression" && init.callee?.name === "require") {
          const mod = literalString(init.arguments?.[0]);
          if (mod === "child_process") facts.childProcessLines.push(line);
          if (mod === "vm") facts.vmLines.push(line);
        }
        break;
      }
      case "CallExpression": {
        const callee = node.callee;
        const calleeName = callee?.type === "Identifier" ? callee.name : null;
        const prop = callee?.type === "MemberExpression" ? memberProp(callee) : null;
        const obj = callee?.type === "MemberExpression" ? objectName(callee.object) : null;

        if (calleeName === "eval") facts.evalLines.push(line);
        if (calleeName === "atob") facts.decodeLines.push(line);
        if (calleeName === "Function") facts.functionCtorLines.push(line);
        if (calleeName === "require") {
          const mod = literalString(node.arguments?.[0]);
          if (mod === "child_process") facts.childProcessLines.push(line);
          if (mod === "vm") facts.vmLines.push(line);
        }
        if (calleeName && NETWORK_CALLEES.has(calleeName)) {
          facts.networkCalls.push({ url: literalString(node.arguments?.[0]), line, via: calleeName });
        }
        if (prop === "sendBeacon") {
          facts.networkCalls.push({ url: literalString(node.arguments?.[0]), line, via: "sendBeacon" });
        }
        if (prop === "open" && node.arguments?.length >= 2) {
          const u = literalString(node.arguments[1]);
          if (u && /^https?:\/\//i.test(u)) facts.networkCalls.push({ url: u, line, via: "XMLHttpRequest.open" });
        }
        if ((prop === "getItem" || prop === "setItem" || prop === "removeItem") && (obj === "localStorage" || obj === "sessionStorage")) {
          const key = literalString(node.arguments?.[0]);
          if (key && TOKEN_KEY_RE.test(key)) facts.storageTokenLines.push(line);
        }
        if (prop === "addEventListener") {
          const ev = literalString(node.arguments?.[0]);
          if (ev === "keydown" || ev === "keyup" || ev === "keypress") facts.keyListenerLines.push(line);
        }
        if (prop === "readText" && obj === "clipboard") facts.clipboardLines.push(line);
        if (prop === "atob") facts.decodeLines.push(line);
        if (prop === "from" && obj === "Buffer") {
          const enc = literalString(node.arguments?.[1]);
          if (enc === "base64") facts.decodeLines.push(line);
        }
        if (prop === "write" && obj === "document") facts.sinkLines.push(line);
        if ((prop === "querySelector" || prop === "querySelectorAll")) {
          const sel = literalString(node.arguments?.[0]);
          if (sel && /password/i.test(sel)) facts.passwordSelectorLines.push(line);
        }
        if (prop === "exec" || prop === "execSync" || prop === "spawn" || prop === "spawnSync") {
          // member call on something obtained from child_process — flag when
          // a child_process import exists in the same file (checked later).
          facts.childProcessLines.push(line);
        }
        if (prop === "rm" || prop === "rmSync" || prop === "unlink" || prop === "unlinkSync" || prop === "rmdir" || prop === "rmdirSync") {
          facts.fsDestructiveLines.push(line);
        }
        break;
      }
      case "NewExpression": {
        const callee = node.callee;
        if (callee?.type === "Identifier" && callee.name === "Function") facts.functionCtorLines.push(line);
        if (callee?.type === "Identifier" && callee.name === "WebSocket") {
          facts.networkCalls.push({ url: literalString(node.arguments?.[0]), line, via: "WebSocket" });
        }
        if (callee?.type === "Identifier" && callee.name === "XMLHttpRequest") {
          facts.networkCalls.push({ url: null, line, via: "XMLHttpRequest" });
        }
        break;
      }
      case "MemberExpression": {
        const prop = memberProp(node);
        const obj = objectName(node.object);
        if (prop === "cookie" && obj === "document") facts.cookieLines.push(line);
        if (prop === "innerHTML" || prop === "outerHTML") {
          // assignment targets are handled in AssignmentExpression; bare reads are benign
        }
        break;
      }
      case "AssignmentExpression": {
        const left = node.left;
        if (left?.type === "MemberExpression") {
          const prop = memberProp(left);
          if (prop === "innerHTML" || prop === "outerHTML") facts.sinkLines.push(line);
        }
        break;
      }
      case "Literal": {
        if (typeof node.value === "string") {
          const v = node.value;
          if (v.length >= 200 && /^[A-Za-z0-9+/]+={0,2}$/.test(v.replace(/\s+/g, "")) && /[+/]/.test(v)) {
            facts.longBase64.push({ line, len: v.length });
          }
        }
        break;
      }
      case "ArrayExpression": {
        const strings = node.elements?.filter((e: any) => e?.type === "Literal" && typeof e.value === "string").length ?? 0;
        if (strings >= 20) facts.bigStringArrays++;
        break;
      }
      default:
        break;
    }
  });

  const findings: Finding[] = [];
  const F = (
    rule_id: string,
    severity: Finding["severity"],
    line: number | null,
    message: string,
    signature = false,
  ) => findings.push({ rule_id, severity, file: path, line, message, ...(signature ? { signature: true } : {}) });

  const hasNetwork = facts.networkCalls.length > 0;
  const hasCredAccess = facts.cookieLines.length > 0 || facts.storageTokenLines.length > 0;

  for (const call of facts.networkCalls) {
    if (!call.url) continue;
    const dest = classifyDestination(call.url);
    if (dest.cls === "webhook-exfil") continue; // generic scan already raised it as a signature
    const host = hostOfUrl(call.url);
    if (isIpHost(host)) {
      F("URL_LITERAL_IP", "medium", call.line, `${call.via} connects to a literal IP address (${host}).`);
    }
  }
  if (facts.cookieLines.length) {
    F("AST_COOKIE_ACCESS", "medium", facts.cookieLines[0], "Code reads document.cookie. In a storefront template this is a classic credential-theft precursor.");
  }
  if (facts.storageTokenLines.length) {
    F("AST_STORAGE_TOKEN", "medium", facts.storageTokenLines[0], "Code accesses token-like keys in web storage (token/auth/session).");
  }
  if (hasCredAccess && hasNetwork) {
    F(
      "EXFIL_COMBO_COOKIE_NETWORK",
      "critical",
      facts.networkCalls[0]?.line ?? facts.cookieLines[0] ?? null,
      "Credential-store access (cookies/token storage) AND a network send occur in the same file — the defining behaviour of a credential stealer.",
      true,
    );
  }
  if (facts.evalLines.length) {
    F("AST_EVAL", "medium", facts.evalLines[0], `Dynamic code execution via eval() (${facts.evalLines.length} occurrence(s)).`);
  }
  if (facts.functionCtorLines.length) {
    F("AST_FUNCTION_CTOR", "high", facts.functionCtorLines[0], "Dynamic code execution via the Function constructor (equivalent to eval, commonly used to hide payloads).");
  }
  if (facts.childProcessLines.length) {
    F("AST_CHILD_PROCESS", "high", facts.childProcessLines[0], "Use of child_process (exec/spawn) — shell command execution has no legitimate place in a storefront deliverable.");
  }
  if (facts.vmLines.length) {
    F("AST_VM", "medium", facts.vmLines[0], "Use of the node:vm module to execute code strings.");
  }
  if (facts.fsDestructiveLines.length) {
    F("AST_FS_DESTRUCTIVE", "medium", facts.fsDestructiveLines[0], "Destructive filesystem calls (rm/unlink/rmdir) present.");
  }
  if (facts.keyListenerLines.length) {
    F("AST_KEYLISTENER", "medium", facts.keyListenerLines[0], "Global keyboard listener (keydown/keyup/keypress) — keylogger behaviour pattern.");
  }
  if (facts.clipboardLines.length) {
    F("AST_CLIPBOARD", "medium", facts.clipboardLines[0], "Code reads the clipboard via navigator.clipboard.readText.");
  }
  if (facts.passwordSelectorLines.length) {
    F("AST_PASSWORD_SELECTOR", "medium", facts.passwordSelectorLines[0], "Code selects password inputs — credential harvesting pattern.");
  }
  const hasSink = facts.sinkLines.length > 0 || facts.evalLines.length > 0 || facts.functionCtorLines.length > 0;
  if (facts.decodeLines.length && hasSink) {
    F(
      "ENCODED_PAYLOAD_EXEC",
      "critical",
      facts.decodeLines[0],
      "Base64 decoding (atob / Buffer.from 'base64') combined with a code-execution or DOM-injection sink (eval / Function / innerHTML / document.write) — encoded payload execution.",
      true,
    );
  } else if (facts.longBase64.length) {
    F("AST_LONG_BASE64", "medium", facts.longBase64[0].line, `Embedded base64 blob of ${facts.longBase64[0].len} chars (possible hidden payload).`);
  } else if (facts.decodeLines.length) {
    F("AST_BASE64_DECODE", "low", facts.decodeLines[0], "Base64 decoding used (atob / Buffer.from). Benign on its own; noted for reviewer context.");
  }

  // Obfuscation scoring.
  const hexEscapes = (text.match(/\\x[0-9a-fA-F]{2}/g) ?? []).length;
  const uniEscapes = (text.match(/\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/g) ?? []).length;
  const oxIds = new Set(text.match(/\b_0x[0-9a-fA-F]{4,}\b/g) ?? []).size;
  const escDensity = text.length > 0 ? (hexEscapes + uniEscapes) / text.length : 0;
  const entropy = textEntropy(text);
  let obfScore = 0;
  if (escDensity > 0.02) obfScore += 2;
  if (oxIds >= 5) obfScore += 2;
  if (facts.bigStringArrays > 0) obfScore += 1;
  if (entropy > 5.4 && text.length > 4000) obfScore += 1;
  if (facts.evalLines.length || facts.functionCtorLines.length) obfScore += 1;
  if (obfScore >= 3) {
    F("OBFUSCATION", "high", null, `Strong obfuscation indicators (score ${obfScore}: escape density ${(escDensity * 100).toFixed(1)}%, _0x identifiers ${oxIds}, string arrays ${facts.bigStringArrays}, entropy ${entropy.toFixed(2)}).`);
  } else if (obfScore === 2) {
    F("OBFUSCATION", "medium", null, `Moderate obfuscation indicators (score ${obfScore}: escape density ${(escDensity * 100).toFixed(1)}%, _0x identifiers ${oxIds}, entropy ${entropy.toFixed(2)}).`);
  }

  return { findings, astPartial: false };
}

/** Regex fallback used when acorn cannot parse the file (TS/JSX/broken). */
export function analyzeJsRegex(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const pushRe = (rule_id: string, severity: Finding["severity"], re: RegExp, message: string, signature = false) => {
    const m = re.exec(text);
    if (m) {
      out.push({ rule_id, severity, file: path, line: lineOf(text, m.index), message, snippet: snippetAt(text, m.index), ...(signature ? { signature: true } : {}) });
    }
  };
  pushRe("AST_EVAL", "medium", /\beval\s*\(/, "Dynamic code execution via eval() (regex layer; file could not be AST-parsed).");
  pushRe("AST_FUNCTION_CTOR", "high", /new\s+Function\s*\(|[^.\w]Function\s*\(\s*['"`]/, "Dynamic code execution via the Function constructor (regex layer).");
  pushRe("AST_CHILD_PROCESS", "high", /require\s*\(\s*['"]child_process['"]\)|from\s+['"]child_process['"]/, "Use of child_process (regex layer).");
  pushRe("AST_COOKIE_ACCESS", "medium", /document\.cookie/, "Code reads document.cookie (regex layer).");
  if (/document\.cookie/.test(text) && /(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket)/.test(text)) {
    pushRe("EXFIL_COMBO_COOKIE_NETWORK", "critical", /document\.cookie/, "Cookie access AND network send in the same file — credential stealer pattern (regex layer).", true);
  }
  if (/(atob\s*\(|Buffer\.from\s*\([^)]*['"]base64['"])/.test(text) && /(eval\s*\(|new\s+Function|\.innerHTML\s*=|document\.write\s*\()/.test(text)) {
    pushRe("ENCODED_PAYLOAD_EXEC", "critical", /atob\s*\(|Buffer\.from/, "Base64 decode combined with a code-execution/DOM sink — encoded payload execution (regex layer).", true);
  }
  pushRe("AST_KEYLISTENER", "medium", /addEventListener\s*\(\s*['"](keydown|keyup|keypress)['"]/, "Global keyboard listener (regex layer).");
  pushRe("AST_LONG_BASE64", "medium", /["'][A-Za-z0-9+/]{200,}={0,2}["']/, "Long embedded base64-looking string literal (regex layer).");
  return out;
}
