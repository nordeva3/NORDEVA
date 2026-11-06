// Language-specific static rules for PHP, Python, shell/PowerShell/Batch and
// HTML. These languages are analysed with anchored regex rules (we have no
// full parsers for them in the dependency budget); every rule records the
// exact line and a snippet so a human reviewer can judge context fast.

import type { Finding, Severity } from "./types";
import { lineOf, snippetAt, hostOfUrl, isIpHost } from "./util";
import { analyzeJsRegex } from "./static";

type Push = (
  rule_id: string,
  severity: Severity,
  re: RegExp,
  message: string,
  signature?: boolean,
) => boolean;

function makePush(path: string, text: string, out: Finding[]): Push {
  return (rule_id, severity, re, message, signature = false) => {
    const m = re.exec(text);
    if (!m) return false;
    out.push({
      rule_id,
      severity,
      file: path,
      line: lineOf(text, m.index),
      message,
      snippet: snippetAt(text, m.index),
      ...(signature ? { signature: true } : {}),
    });
    return true;
  };
}

const SUPERGLOBAL = /\$_(GET|POST|REQUEST|COOKIE|FILES)\b/;

/** True when a superglobal appears on the same line or within `window` lines after offset. */
function superglobalNear(text: string, offset: number, windowLines = 3): boolean {
  const after = text.slice(offset, offset + 1200);
  const lines = after.split("\n").slice(0, windowLines + 1).join("\n");
  const before = text.slice(Math.max(0, offset - 400)).split("\n").slice(-2).join("\n");
  return SUPERGLOBAL.test(lines) || SUPERGLOBAL.test(before);
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

export function analyzePhp(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const push = makePush(path, text, out);

  const hasEval = push("PHP_EVAL", "high", /\beval\s*\(/, "PHP eval() executes a string as code.");
  push("PHP_EVAL", "high", /\bcreate_function\s*\(/, "PHP create_function() creates code from strings (eval equivalent).");
  push("PHP_ASSERT_EVAL", "medium", /\bassert\s*\(\s*['"]/, "PHP assert() with a string argument evaluates code.");
  push(
    "PHP_PREG_REPLACE_E",
    "high",
    /preg_replace\s*\(\s*(['"])[^'"]*\/[a-zA-Z]*e[a-zA-Z]*\1/,
    "preg_replace with the /e modifier evaluates the replacement as PHP code.",
  );
  push(
    "PHP_REMOTE_INCLUDE",
    "high",
    /\b(include|include_once|require|require_once)\s*\(?\s*['"]https?:\/\//,
    "include/require of a remote URL — remote code inclusion.",
  );

  const shellFn = /\b(system|exec|passthru|shell_exec|popen|proc_open)\s*\(/g;
  let m: RegExpExecArray | null;
  let shellReported = false;
  while ((m = shellFn.exec(text)) !== null) {
    if (superglobalNear(text, m.index)) {
      out.push({
        rule_id: "WEBSHELL_SUPERGLOBAL",
        severity: "critical",
        file: path,
        line: lineOf(text, m.index),
        message: `PHP shell function ${m[1]}() is reachable from user input ($_GET/$_POST/$_REQUEST/$_COOKIE) — a webshell/backdoor.`,
        snippet: snippetAt(text, m.index),
        signature: true,
      });
      shellReported = true;
      break;
    }
  }
  if (!shellReported) {
    push("PHP_SHELL_FUNC", "high", /\b(system|exec|passthru|shell_exec|popen|proc_open)\s*\(/, "PHP shell execution function used (system/exec/passthru/shell_exec/popen/proc_open).");
  }

  const fput = /\bfile_put_contents\s*\(/g;
  while ((m = fput.exec(text)) !== null) {
    if (superglobalNear(text, m.index)) {
      out.push({
        rule_id: "PHP_FILE_PUT_INPUT",
        severity: "high",
        file: path,
        line: lineOf(text, m.index),
        message: "file_put_contents() writes data derived from user input — arbitrary file upload/dropper pattern.",
        snippet: snippetAt(text, m.index),
      });
      break;
    }
  }

  const hasDecode = push("PHP_BASE64_DECODE", "low", /\bbase64_decode\s*\(/, "base64_decode() used (benign alone; noted for context).");
  if (hasDecode && hasEval) {
    // Upgrade: decode + eval in one file is the classic shell-loader shape.
    out.push({
      rule_id: "ENCODED_PAYLOAD_EXEC",
      severity: "critical",
      file: path,
      line: lineOf(text, text.search(/\bbase64_decode\s*\(/)),
      message: "base64_decode() combined with eval() in the same PHP file — encoded payload execution (shell loader).",
      signature: true,
    });
  }
  push("PHP_HIDDEN_BEHAVIOUR", "medium", /\bmove_uploaded_file\s*\(/, "move_uploaded_file() present — verify the upload path is validated; unrestricted upload endpoints are a top webshell vector.");
  return out;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

export function analyzePython(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const push = makePush(path, text, out);

  push(
    "PY_CRED_STORE",
    "critical",
    /(Login Data|Local State|Google\\Chrome\\User Data|Mozilla\\Firefox\\Profiles|\\AppData\\.*(Cookies|Login Data))/,
    "Code references browser credential stores (Login Data / Cookies / Local State) — credential theft.",
    true,
  );
  const hasExec = push("PY_EVAL_EXEC", "high", /\b(eval|exec|compile)\s*\(/, "Python eval/exec/compile executes dynamic code.");
  push("PY_SUBPROCESS", "medium", /\b(os\.system|os\.popen|subprocess\.(run|Popen|call|check_output|check_call))\b/, "Shell command execution via os.system/subprocess.");
  push("PY_SOCKET", "medium", /\bsocket\.socket\b|\.connect\s*\(\s*\(/, "Raw socket usage — unusual in a deliverable; possible C2/reverse-shell channel.");
  if (/\bbase64\.b64decode\b/.test(text) && hasExec) {
    out.push({
      rule_id: "ENCODED_PAYLOAD_EXEC",
      severity: "critical",
      file: path,
      line: lineOf(text, text.search(/\bbase64\.b64decode\b/)),
      message: "base64.b64decode combined with eval/exec in the same file — encoded payload execution.",
      signature: true,
    });
  } else {
    push("PY_BASE64_DECODE", "low", /\bbase64\.b64decode\b/, "base64 decoding used (benign alone; noted for context).");
  }
  push("PY_KEYLOGGER", "high", /\b(pynput|GetAsyncKeyState|keyboard\.on_press|keyboard\.hook)\b/, "Keyboard capture library/API (pynput / GetAsyncKeyState / keyboard hook) — keylogger pattern.");
  push("PY_KEYRING", "medium", /\bkeyring\.(get_password|get_credential)\b/, "OS keyring credential access.");
  push("PY_PERSISTENCE", "medium", /(crontab|CurrentVersion\\Run|LaunchAgents|systemd\/.*\.service|shutil\.copy[^\n]*(Startup|Start Menu))/, "Persistence mechanism (crontab / registry Run key / LaunchAgent / systemd / startup copy).");
  push("PY_CTYPES", "medium", /\bctypes\.(CDLL|WinDLL|windll|cdll)\b/, "ctypes native library loading — can call arbitrary OS APIs, bypassing Python-level review.");
  push("PY_CRED_PATHS", "high", /(os\.path\.expanduser[^\n]*(Cookies|Login Data)|\.config\/(google-chrome|chromium|BraveSoftware))/, "Code builds paths into browser profile directories.");
  return out;
}

// ---------------------------------------------------------------------------
// Shell / PowerShell / Batch
// ---------------------------------------------------------------------------

export function analyzeShell(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const push = makePush(path, text, out);

  if (/\bwget\b/.test(text) && /chmod\s+\+x/.test(text)) {
    const idx = text.search(/\bwget\b/);
    out.push({
      rule_id: "DOWNLOAD_EXEC",
      severity: "critical",
      file: path,
      line: lineOf(text, idx),
      message: "Script downloads a file with wget and marks it executable (download-and-execute dropper pattern).",
      snippet: snippetAt(text, idx),
      signature: true,
    });
  }
  push("SHELL_PERSISTENCE", "medium", /\bcrontab\b|\/etc\/cron/, "Script touches cron scheduling (persistence).");
  push("SHELL_ANTI_FORENSICS", "medium", /(history\s+-c|rm\s+[^\n]*\.bash_history|unset\s+HISTFILE)/, "Shell history tampering — anti-forensics behaviour.");
  push("PS_ENCODED", "high", /-(e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i, "PowerShell invoked with an encoded command (-enc) — the standard way to hide a payload.");
  push("PS_IEX", "medium", /\b(Invoke-Expression|IEX)\b/, "PowerShell Invoke-Expression executes a string as code.");
  push("PS_HIDDEN", "medium", /-WindowStyle\s+Hidden/i, "PowerShell run with a hidden window.");
  push("SHELL_CHMOD_WORLD", "low", /chmod\s+777\b/, "chmod 777 makes files world-writable/executable.");
  return out;
}

// ---------------------------------------------------------------------------
// HTML / SVG / XML
// ---------------------------------------------------------------------------

export function analyzeHtml(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const push = makePush(path, text, out);
  void push;

  // External script sources.
  for (const m of text.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    const src = m[1];
    const idx = m.index ?? 0;
    if (/^data:/i.test(src)) {
      out.push({ rule_id: "HTML_SCRIPT_DATA_URI", severity: "high", file: path, line: lineOf(text, idx), message: "Script loaded from a data: URI — code hidden inside the page itself.", snippet: snippetAt(text, idx) });
    } else if (/^https?:\/\//i.test(src) || src.startsWith("//")) {
      const host = hostOfUrl(src.startsWith("//") ? `https:${src}` : src);
      if (isIpHost(host)) {
        out.push({ rule_id: "HTML_EXT_SCRIPT_IP", severity: "high", file: path, line: lineOf(text, idx), message: `External script loaded from a literal IP address (${host}) — injected-script pattern.`, snippet: snippetAt(text, idx) });
      } else {
        out.push({ rule_id: "HTML_EXT_SCRIPT", severity: "info", file: path, line: lineOf(text, idx), message: `External script loaded from ${host ?? src.slice(0, 60)} — third-party code runs with page privileges; reviewer should confirm it is expected.` });
      }
    }
  }
  // Hidden iframes.
  for (const m of text.matchAll(/<iframe\b[^>]*>/gi)) {
    const tag = m[0];
    const idx = m.index ?? 0;
    if (/(width|height)\s*=\s*["']?0\b/.test(tag) || /display\s*:\s*none/i.test(tag) || /visibility\s*:\s*hidden/i.test(tag)) {
      out.push({ rule_id: "HTML_HIDDEN_IFRAME", severity: "medium", file: path, line: lineOf(text, idx), message: "Hidden iframe (zero size or display:none) — drive-by / clickjacking / silent-redirect pattern.", snippet: snippetAt(text, idx) });
    }
  }
  // Meta refresh to external URL.
  for (const m of text.matchAll(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi)) {
    const tag = m[0];
    const urlM = /url\s*=\s*([^"'\s>]+)/i.exec(tag);
    if (urlM && /^https?:\/\//i.test(urlM[1])) {
      const host = hostOfUrl(urlM[1]);
      out.push({
        rule_id: "HTML_META_REFRESH_EXT",
        severity: isIpHost(host) ? "high" : "medium",
        file: path,
        line: lineOf(text, m.index ?? 0),
        message: `Meta-refresh redirects visitors to an external URL (${urlM[1].slice(0, 100)}).`,
        snippet: snippetAt(text, m.index ?? 0),
      });
    }
  }
  // Form actions.
  for (const m of text.matchAll(/<form\b[^>]*action\s*=\s*["']([^"']+)["']/gi)) {
    const action = m[1];
    if (/^https?:\/\//i.test(action)) {
      const host = hostOfUrl(action);
      out.push({
        rule_id: isIpHost(host) ? "HTML_FORM_ACTION_IP" : "HTML_FORM_ACTION_EXT",
        severity: isIpHost(host) ? "high" : "medium",
        file: path,
        line: lineOf(text, m.index ?? 0),
        message: `Form submits to ${isIpHost(host) ? `a literal IP address (${host})` : `an external host (${host})`} — credential-phishing pattern if the form collects logins or payment data.`,
        snippet: snippetAt(text, m.index ?? 0),
      });
    }
  }
  // Inline script blocks get the JS regex rules, with lines mapped back.
  for (const m of text.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const code = m[1];
    if (!code || code.trim().length < 8) continue;
    const baseOffset = (m.index ?? 0) + m[0].indexOf(code);
    const baseLine = lineOf(text, baseOffset);
    for (const f of analyzeJsRegex(path, code)) {
      out.push({ ...f, line: (f.line ?? 1) + baseLine - 1, message: `${f.message} (inline <script> block)` });
    }
  }
  return out;
}
