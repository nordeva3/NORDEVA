// Signature data and file-type sniffing.
//
// "Confirmed" signatures (EICAR, webshell cores, miner pools, stealer exfil
// endpoints, reverse shells, encoded-payload execution, exfil combos) are the
// patterns that — on their own — justify a `dangerous` verdict. They are
// deliberately few and specific: a long list of weak strings would drown real
// findings in false positives. Heuristics live in static.ts; this file holds
// the high-precision data plus magic-byte type sniffing (never trust the
// file name or extension an uploader claims).

export const RULES_VERSION = "1.0.0";
export const SCANNER_VERSION = "1.0.0";

/** Canonical EICAR anti-malware test string and the SHA-256 of the file. */
export const EICAR_STRING =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
export const EICAR_SHA256 =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

/** Well-known webshell family markers (core strings, not generic keywords). */
export const WEBSHELL_SIGNATURES: Array<{ needle: string; family: string }> = [
  { needle: "c99shell", family: "c99 shell" },
  { needle: "r57shell", family: "r57 shell" },
  { needle: "b374k", family: "b374k shell" },
  { needle: "WSO 2.", family: "WSO shell" },
  { needle: "FilesMan", family: "WSO/FilesMan shell" },
  { needle: "gzinflate(base64_decode", family: "obfuscated PHP shell loader" },
  { needle: "eval(gzinflate", family: "obfuscated PHP shell loader" },
  { needle: "eval(gzuncompress", family: "obfuscated PHP shell loader" },
];

/** Cryptominer indicators: pool hosts, stratum protocol, known web miners. */
export const MINER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /stratum\+tcp:\/\//i, label: "stratum mining protocol endpoint" },
  { re: /pool\.minexmr\.com/i, label: "MineXMR pool" },
  { re: /xmrpool[a-z0-9.-]*/i, label: "XMR pool host" },
  { re: /coinhive\.com/i, label: "Coinhive web miner" },
  { re: /cryptonight/i, label: "CryptoNight miner reference" },
  { re: /minergate\.com/i, label: "MinerGate pool" },
  { re: /pool\.supportxmr\.com/i, label: "supportXMR pool" },
  { re: /xmrig/i, label: "XMRig miner reference" },
];

export type DestinationClass = "webhook-exfil" | "ip" | "normal";

const WEBHOOK_EXFIL_RES: Array<{ re: RegExp; label: string }> = [
  { re: /discord(?:app)?\.com\/api\/webhooks\//i, label: "Discord webhook (classic stealer exfiltration channel)" },
  { re: /api\.telegram\.org\/bot[\w:-]+/i, label: "Telegram Bot API with embedded bot token (stealer exfiltration channel)" },
];

/** Classify a URL/host for exfiltration risk. */
export function classifyDestination(url: string): { cls: DestinationClass; label?: string } {
  for (const { re, label } of WEBHOOK_EXFIL_RES) {
    if (re.test(url)) return { cls: "webhook-exfil", label };
  }
  return { cls: "normal" };
}

export function isWebhookExfil(text: string): { hit: boolean; label?: string } {
  for (const { re, label } of WEBHOOK_EXFIL_RES) {
    if (re.test(text)) return { hit: true, label };
  }
  return { hit: false };
}

export type SniffedKind =
  | "zip"
  | "gzip"
  | "tar"
  | "7z"
  | "rar"
  | "pdf"
  | "pe"
  | "elf"
  | "macho"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "mp3"
  | "mp4"
  | "font"
  | "class"
  | "wasm"
  | "unknown";

/** Sniff a file's real type from its leading bytes. */
export function sniffKind(buf: Buffer): SniffedKind {
  if (buf.length >= 4) {
    // ZIP (also jar/apk/docx etc. — all opened with the ZIP reader)
    if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return "zip";
    // gzip
    if (buf[0] === 0x1f && buf[1] === 0x8b) return "gzip";
    // 7z
    if (buf.length >= 6 && buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return "7z";
    // RAR
    if (buf.length >= 7 && buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return "rar";
    // PDF
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";
    // PE / DOS executable
    if (buf[0] === 0x4d && buf[1] === 0x5a) return "pe";
    // ELF
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return "elf";
    // Mach-O (32/64, both endianesses, and universal)
    const m = buf.readUInt32BE(0);
    if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcafebabe || m === 0xcefaedfe || m === 0xcffaedfe) return "macho";
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "gif";
    // Java class
    if (m === 0xcafebabe) return "class"; // unreachable (macho above) but kept for clarity
    if (buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) return "class";
    // WebAssembly
    if (buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d) return "wasm";
    // MP3 (ID3 tag or frame sync)
    if ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "mp3";
    // Fonts: woff, woff2, ttf, otf
    const tag = buf.subarray(0, 4).toString("latin1");
    if (tag === "wOFF" || tag === "wOF2" || tag === "true" || tag === "OTTO" || (buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0)) return "font";
  }
  if (buf.length >= 12) {
    const riff = buf.subarray(0, 4).toString("latin1");
    const form = buf.subarray(8, 12).toString("latin1");
    if (riff === "RIFF" && form === "WEBP") return "webp";
    if (form === "ftyp" || riff === "ftyp") return "mp4";
  }
  // tar: "ustar" magic at offset 257
  if (buf.length >= 265 && buf.subarray(257, 262).toString("latin1") === "ustar") return "tar";
  return "unknown";
}

export const MEDIA_KINDS: ReadonlySet<SniffedKind> = new Set([
  "png",
  "jpeg",
  "gif",
  "webp",
  "mp3",
  "mp4",
  "font",
]);

export const EXECUTABLE_KINDS: ReadonlySet<SniffedKind> = new Set(["pe", "elf", "macho", "class", "wasm"]);

export const EXECUTABLE_EXTS: ReadonlySet<string> = new Set([
  "exe", "dll", "so", "dylib", "com", "scr", "msi", "class", "jar", "war",
  "wasm", "bin", "elf", "sys", "ocx", "cpl", "appimage", "deb", "rpm",
]);

export const TEXT_EXTS: ReadonlySet<string> = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "html", "htm", "css",
  "php", "py", "sh", "bash", "zsh", "ps1", "bat", "cmd", "xml", "svg",
  "txt", "md", "yml", "yaml", "toml", "ini", "env", "cfg", "conf", "sql",
  "rb", "pl", "lua", "vue", "svelte", "lock",
]);

export const ARCHIVE_EXTS: ReadonlySet<string> = new Set([
  "zip", "jar", "war", "apk", "tar", "gz", "tgz",
]);
