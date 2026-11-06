import * as crypto from "node:crypto";

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Shannon entropy in bits/byte, computed over at most `sampleBytes`. */
export function shannonEntropy(buf: Buffer, sampleBytes = 256 * 1024): number {
  if (buf.length === 0) return 0;
  const sample = buf.length > sampleBytes ? buf.subarray(0, sampleBytes) : buf;
  const counts = new Array<number>(256).fill(0);
  for (const b of sample) counts[b]++;
  let entropy = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / sample.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Entropy of a text string (per character), used for obfuscation scoring. */
export function textEntropy(text: string, sampleChars = 200_000): number {
  if (text.length === 0) return 0;
  const sample = text.length > sampleChars ? text.slice(0, sampleChars) : text;
  const counts = new Map<string, number>();
  for (const ch of sample) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / sample.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** 1-based line number of a character offset within text. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Extract the source line containing `offset`, trimmed and capped. */
export function snippetAt(text: string, offset: number, max = 160): string {
  let start = offset;
  while (start > 0 && text[start - 1] !== "\n") start--;
  let end = offset;
  while (end < text.length && text[end] !== "\n") end++;
  const line = text.slice(start, end).trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/** True when the buffer decodes as mostly-printable UTF-8 text. */
export function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  return control / sample.length < 0.05;
}

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx + 1).toLowerCase();
}

/** Normalize an archive entry path for display; flags traversal attempts. */
export function sanitizeEntryPath(raw: string): { path: string; traversal: boolean } {
  const normalized = raw.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const traversal =
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    segments.some((s) => s === "..");
  const clean = segments.filter((s) => s !== "" && s !== "." && s !== "..").join("/");
  return { path: clean || "(unnamed)", traversal };
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isIpHost(host: string | null): boolean {
  if (!host) return false;
  return IPV4_RE.test(host) || host.includes(":");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2; // callers only care about distance <= 1
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let minRow = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < minRow) minRow = curr[j];
    }
    if (minRow > 1) return 2;
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}
