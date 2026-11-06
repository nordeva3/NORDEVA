# NORDEVA Shield — marketplace malware scanning service

A standalone microservice that scans seller uploads for the NORDEVA
marketplace. It downloads an asset from the private Supabase Storage bucket
`listing-files`, runs a multi-layer detection pipeline, and returns a
structured verdict report. It is deliberately honest: everything it could
not inspect is reported as uninspected and drives the verdict to
`incomplete` — an incomplete scan is never presented as a clean one.

- Runtime: Node.js ≥ 20, TypeScript (strict), compiled with `tsc` to `dist/`.
- HTTP: `node:http` only (no framework). Dependencies: `acorn` (JS AST) and
  `yauzl` (ZIP reading). Everything else is the Node standard library.
- The engine (`src/engine.ts`, exported `scanBuffer`) is importable without
  starting the server; the HTTP layer (`src/server.ts`) is a thin wrapper.

## Running

```bash
npm ci
npm run build
SCANNER_TOKEN=... SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... npm start        # node dist/server.js
```

Docker:

```bash
docker build -t nordeva-shield .
docker run -p 8080:8080 \
  -e SCANNER_TOKEN=... \
  -e SUPABASE_URL=https://<project>.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  nordeva-shield
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `8080` | HTTP listen port |
| `SCANNER_TOKEN` | **yes** | — | Bearer token the marketplace must send. The service refuses to start without it (fail closed). Compared in constant time. |
| `SUPABASE_URL` | for scans | — | Base URL of the Supabase project; assets are downloaded from `{SUPABASE_URL}/storage/v1/object/listing-files/{path}` |
| `SUPABASE_SERVICE_ROLE_KEY` | for scans | — | Used **only** as the `apikey`/`Authorization` headers on that one storage download. Never logged, never returned in any response. Server-side only. |
| `OSV_ENABLED` | no | off | Set to `1` to enable OSV vulnerability lookups for pinned dependency versions (see layer D). |
| `SCAN_MAX_DOWNLOAD_BYTES` | no | 134217728 (128 MiB) | Hard cap on the downloaded asset |
| `SCAN_MAX_ENTRIES` | no | 2000 | Max archive entries per scan |
| `SCAN_MAX_TOTAL_UNCOMPRESSED` | no | 268435456 (256 MiB) | Max total expanded bytes per scan |
| `SCAN_MAX_ENTRY_BYTES` | no | 67108864 (64 MiB) | Max bytes read per archive entry |
| `SCAN_MAX_DEPTH` | no | 3 | Max nested-archive depth |
| `SCAN_MAX_RATIO` | no | 100 | Max per-entry compression ratio before an entry is treated as a bomb |
| `SCAN_TEXT_ANALYSIS_CAP` | no | 8388608 (8 MiB) | Text files above this are only partially analyzed (and counted uninspected) |
| `SCAN_SANDBOX_MAX_BYTES` | no | 262144 (256 KiB) | Max JS file size eligible for the sandbox |

## API contract

### `GET /health`

`200 {"ok":true,"service":"nordeva-shield","rules_version":"1.0.0"}`

### `POST /scan`

Request (exactly what the marketplace app sends today):

```json
{
  "listing_id": "…", "asset_id": "…",
  "path": "storage/object/path.zip",
  "file_name": "product.zip", "mime_type": "application/zip",
  "file_size": 123456, "sha256": "<hex sha256 of the object>"
}
```

Auth: `Authorization: Bearer <SCANNER_TOKEN>` → `401` without a match.
Malformed JSON / missing fields / bad `sha256` format / `..` in `path` →
`400`. Path traversal in `path` is rejected because the path is interpolated
into the storage URL.

Handling, in order:

1. The object is streamed from Supabase Storage with a hard 128 MiB cap.
   Over the cap → `200` with status `incomplete` (a `DOWNLOAD_TOO_LARGE`
   finding), never a crash.
2. The downloaded bytes are hashed. If the SHA-256 differs from the body's
   `sha256` → `200` with status `incomplete` and a critical
   `INTEGRITY_SHA_MISMATCH` finding (also the response `signature`). The
   content is **not** scanned further — it is not the file that was
   registered.
3. Otherwise the pipeline runs. Scanning never throws on file content: any
   per-file failure is recorded in the coverage accounting instead. `500`
   is reserved for genuine internal faults and missing server configuration;
   a storage `404` maps to `404` and other storage failures to `502`.

Response `200`:

```json
{
  "status": "safe" | "warning" | "dangerous" | "incomplete",
  "scanner_version": "1.0.0",
  "signature": "SIG_EICAR" | null,
  "findings": { /* REPORT, see below */ }
}
```

`signature` is the primary confirmed signature/rule id (the highest-severity
signature-flagged finding), or `null`.

### REPORT (`findings`) schema

```jsonc
{
  "verdict": "safe|warning|dangerous|incomplete",   // same as status
  "rules_version": "1.0.0",
  "duration_ms": 123,
  "sha256_match": true,
  "size_bytes": 123456,
  "coverage": {
    "entries_total": 10,     // archive entries encountered
    "files_total": 9,        // member files (directories excluded)
    "files_inspected": 7,
    "files_skipped": 2       // files_total - files_inspected
  },
  "files": [
    { "path": "product.zip!src/app.js", "size": 4211, "type": "javascript",
      "inspected": true, "layers": ["archive", "static", "sandbox"] },
    { "path": "product.zip!setup.exe", "size": 90210, "type": "pe",
      "inspected": false, "layers": ["archive"],
      "skipped_reason": "executable binary — strings scanned only, content not executed or fully inspected" }
  ],
  "findings": [
    { "rule_id": "EXFIL_DISCORD_WEBHOOK", "severity": "critical",
      "file": "product.zip!stealer.js", "line": 4,
      "message": "…", "snippet": "…(≤160 chars)…" }
  ],
  "layers": {
    "archive":      { "status": "ok|limited|failed", "notes": ["…"] },
    "static":       { "status": "ok", "files_analyzed": 7 },
    "signatures":   { "status": "ok", "hits": ["SIG_EICAR"] },
    "dependencies": { "status": "ok|disabled|unavailable", "manifests": 1,
                      "issues": [{ "file": "…", "message": "…", "severity": "high" }] },
    "sandbox":      { "status": "ok|skipped", "files_run": 2,
                      "behaviors": [{ "file": "…", "kind": "network", "detail": "https://…" }] }
  },
  "limits_hit": ["ratio:product.zip!bomb.txt"]
}
```

Nested members are joined with `!` in paths (e.g. `outer.zip!inner.zip!a.js`).

## Pipeline layers

### A. Archive safety (`src/archive.ts`)

- Type is sniffed from **magic bytes** (ZIP, gzip, tar, 7z, RAR, PDF, PE,
  ELF, Mach-O, PNG/JPEG/GIF/WebP, MP3/MP4, fonts, Java class, WASM), never
  from the claimed name — a renamed executable is still an executable.
- ZIPs are read with **yauzl** (lazy entries, size-validated). Tar is read
  with a built-in ustar reader (GNU longname + pax `path` records); gzip via
  `node:zlib` with an output cap.
- **Hostile-name fallback:** yauzl aborts an *entire* archive when a single
  entry name fails its (non-configurable) filename validation (`..`,
  absolute paths, backslashes). Letting one hostile name blind the scanner
  to every other entry is unacceptable, so when the central directory
  contains such names, the archive is read with a built-in
  central-directory reader instead (same per-entry processor, same limits,
  CRC-32 verified). This is the one place a hand-rolled ZIP reader is used,
  and only for archives yauzl cannot safely read.
- **Nothing is ever written to disk.** Entries are read into memory under
  hard budgets, so path traversal cannot touch the filesystem. Traversal
  names are still reported (`ARCHIVE_PATH_TRAVERSAL`, medium).
- Limits (all env-overridable, see table): 2000 entries, 256 MiB total
  uncompressed, 64 MiB per entry, nesting depth 3. Per-entry compression
  ratio > 100:1 (with declared size > 1 MiB) is checked **from the central
  directory before decompression** → `ARCHIVE_BOMB_RATIO` (high), the entry
  is not expanded. Encrypted entries are recorded uninspectable
  (`ARCHIVE_ENCRYPTED_ENTRY`), never as clean. 7z/RAR members (top-level or
  nested) are reported as unsupported → uninspected.

### B. Per-file classification & coverage (`src/engine.ts`)

Every member file gets a `files[]` record — total and inspected counts are
always exact. Text types (js/jsx/ts/tsx/mjs/cjs/json/html/css/php/py/sh/
ps1/bat/xml/svg/txt/md/yml/toml/ini/env…) get static analysis. Media files
whose magic matches their class are fingerprinted (type + size + entropy)
and counted inspected-by-fingerprint; a ZIP signature hiding inside a media
file is flagged as a polyglot. Other binaries (exe/dll/so/class/wasm…) are
string-scanned for URLs/suspicious strings but recorded **not
content-inspected**, which drives `incomplete`.

### C. Static analysis (`src/static.ts`, `src/langrules.ts`, `src/signatures.ts`)

- **JS/TS** — parsed with **acorn** (module, then script; unparseable
  JSX/TS falls back to the regex rules and marks the AST layer partial).
  AST rules: `eval`/`Function` constructor, `child_process`/`vm` imports,
  destructive `fs` calls, network calls (`fetch`, `XMLHttpRequest`,
  `WebSocket`, `sendBeacon`) with literal URLs, `document.cookie` access,
  token-like `localStorage`/`sessionStorage` keys, keyboard listeners,
  `clipboard.readText`, password-field selectors, base64 decoders
  (`atob`, `Buffer.from(…, 'base64')`), and execution sinks (`innerHTML`,
  `document.write`). Combinations escalate: credential access + network in
  one file ⇒ `EXFIL_COMBO_COOKIE_NETWORK` (critical); decode chain flowing
  into an execution sink ⇒ `ENCODED_PAYLOAD_EXEC` (critical). Obfuscation
  is scored from escape density, `_0x…` identifier density, string-array
  indirection, big base64 literals and file entropy; score ≥ 3 ⇒ high.
- **Known-bad destinations** — Discord webhook URLs and Telegram bot API
  URLs with tokens ⇒ critical exfiltration signatures; miner pools/stratum
  endpoints (`pool.minexmr.com`, `stratum+tcp://`, CoinHive, XMRig markers…)
  ⇒ `SIG_MINER` (critical); literal-IP URLs ⇒ medium; reverse shells
  (`/dev/tcp/`, `nc -e`, `bash -i`), `curl | sh` / `IEX DownloadString`
  download-and-execute ⇒ critical.
- **PHP** — `eval`, `create_function`, string-`assert`, `preg_replace /e`,
  remote `include`, `base64_decode` adjacent to `eval`; shell functions
  (`system`, `exec`, `passthru`, `shell_exec`, `popen`, `proc_open`) fed by
  `$_GET/$_POST/$_REQUEST/$_COOKIE` ⇒ `WEBSHELL_SUPERGLOBAL` (critical);
  `file_put_contents` with user input; known webshell strings (c99shell,
  r57shell, b374k, WSO, FilesMan…).
- **Python** — `eval`/`exec`/`compile`, `os.system`, `subprocess`, sockets,
  base64+exec chains, browser credential-store paths (`Login Data`,
  `Local State`) ⇒ critical, `keyring`, `pynput`/keylogger APIs,
  persistence (crontab), `ctypes` loading.
- **Shell / PowerShell / Batch** — download-and-execute, `chmod +x` after
  download, reverse shells, crontab writes, history tampering, PowerShell
  `-EncodedCommand` and `IEX (New-Object Net.WebClient).DownloadString`.
- **HTML** — external `<script src>` (IP host or `data:` ⇒ high), hidden
  iframes, meta-refresh to external URLs, form actions to IP hosts; inline
  `<script>` blocks are extracted and run through the JS rules.
- **Generic** — EICAR test string *and* its canonical SHA-256
  (`275a021b…fd0f`), webshell signature strings, and a capped URL/IP
  inventory (info) for every text file.

### D. Dependency analysis (`src/deps.ts`)

Finds `package.json`, `requirements.txt`, `composer.json`, `Gemfile`
anywhere in the archive. Flags: dependencies resolved from `git+`/http(s)/
file URLs (high — non-registry code), install hooks
(`preinstall`/`install`/`postinstall`/`prepare`, composer install commands)
that fetch remote code (critical) or run shell/other commands (high/medium),
a short built-in known-bad list (illustrative, e.g. `discord.js-selfbot`,
token-grabber packages), and **edit-distance-1 typosquats** of a top-30
npm / top-PyPI list (medium). When `OSV_ENABLED=1`, exact-pinned versions
are queried against `https://api.osv.dev/v1/querybatch` with a 4 s timeout;
any failure marks the layer `unavailable` and is never fatal. Unpinned
ranges are not queried (OSV needs exact versions) — coverage notes say so.

### E. Sandbox dynamic analysis (`src/sandbox.ts`, `src/sandbox-runner.ts`)

Eligible files: `.js/.mjs/.cjs`, ≤ 256 KiB, with no `import`/`export`/
`require` (module files are skipped with the reason recorded). Each file
runs in its **own child Node process**: `--max-old-space-size=64`,
environment scrubbed to `PATH` only, cwd = a fresh empty temp dir (deleted
afterwards), 2.5 s wall-clock kill. The source is passed over **stdin** —
it is never written to disk or `require`d as a module — and executed via
`node:vm` (1.8 s vm timeout) against a frozen, instrumented global:

- `fetch` / `XMLHttpRequest` / `WebSocket` / `navigator.sendBeacon` record
  `{kind:"network", detail:url}` and return dummies/throw — no real network
  is possible from the stubs, and the deployment should still deny egress
  (see Limitations).
- `document.cookie` getter/setter, `localStorage`/`sessionStorage`,
  `navigator.clipboard`, keyboard listeners record access.
- `eval`/`Function` inside the realm are wrapped to record use, then run.
- Timers are accelerated and capped so loops terminate.

Behaviors feed findings: network attempt to a webhook ⇒
`SANDBOX_EXFIL_ATTEMPT` (critical); to a literal IP ⇒ high; cookie/token
access combined with network ⇒ critical combo; `eval` at runtime ⇒ medium;
clipboard/keyboard capture ⇒ medium. A crash or timeout is recorded as an
info behavior note, never as a layer failure.

### F. Verdict aggregation (exact rules)

Applied in `src/engine.ts` (and commented there):

1. **dangerous** — any `critical` finding. (All confirmed signatures —
   EICAR, miner pool/stratum, webshell core signatures, credential-exfil
   combo, encoded-payload execution, reverse shell — are emitted at
   critical severity, so this also covers "any confirmed signature hit".)
2. else **incomplete** — any file not inspected for a content reason:
   unsupported archive (7z/RAR), encrypted entry, executable or unknown
   binary not content-inspected, truncated/oversized file, text file over
   the analysis cap, limits preventing full inspection, unreadable entry.
   (Media files inspected by fingerprint do **not** count as uninspected.)
3. else **warning** — any `high` finding, or ≥ 3 `medium` findings, or a
   high obfuscation score on any file (emitted as a high finding).
4. else **safe**.

The SHA-mismatch and over-cap cases short-circuit to `incomplete` before
the pipeline, as described under the API contract.

## Tests

```bash
npm test   # tsc -p tsconfig.test.json && node --test "dist-test/test/*.test.js"
```

15 `node:test` fixtures drive `scanBuffer` directly (archives are built
programmatically by a stored/deflate ZIP writer and a ustar writer in
`test/` — no extra dependencies):

1. clean template project (html/css/benign js) → `safe`, full coverage
2. EICAR in a zip → `dangerous`, `SIG_EICAR`
3. JS stealer (cookie → Discord webhook) → `dangerous` incl. sandbox exfil
4. miner config (stratum + Monero pool) → `dangerous`, `SIG_MINER`
5. base64 blob + `eval(atob(…))` → `dangerous`, `ENCODED_PAYLOAD_EXEC`
6. PHP `shell_exec($_REQUEST[…])` → `dangerous`, `WEBSHELL_SUPERGLOBAL`
7. stealer inside a **nested** zip → `dangerous`
8. fake `.exe` (MZ + filler) → `incomplete`, exe recorded uninspected
9. 30 MiB-of-zeros deflate bomb → ratio limit hit + `incomplete`, no crash
10. `../evil.js` entry → traversal finding, nothing written to disk
11. `package.json` postinstall `curl … | sh` → ≥ `warning`, hook rule fires
12. benign JS fetching a normal https domain → `safe`, no high/critical
13. tar.gz of benign text files → `safe`, full coverage
14. single-file `.js` stealer (no archive) → `dangerous`
15. unsupported 7z asset → `incomplete`, zero files claimed inspected

Last verified: **15/15 passing** (Node 24), plus an HTTP smoke test against
a mock storage server (health, 401, 400, sha-mismatch → `incomplete`,
EICAR zip → `dangerous`/`SIG_EICAR`).

## Honest limitations — read before trusting a "safe"

- **No commercial AV feed.** Signatures are a curated built-in set (EICAR,
  known webshells, miner endpoints, exfil patterns) plus heuristics. This
  is real multi-layer detection, but it is **not** a replacement for a
  commercial engine (ClamAV with daily signatures, VirusTotal, etc.), and
  no scanner can guarantee 100% detection. Zero-day and heavily packed
  malware can pass.
- **The sandbox is `node:vm` + process isolation, not a full OS sandbox.**
  `vm` is not a security boundary by itself; the real isolation is the
  separate process, scrubbed environment, memory cap, wall-clock kill and
  empty cwd. **Deploy it in a container/VM with egress restricted to the
  Supabase storage endpoint only**, with no credentials in the environment
  beyond the storage key it needs. Treat the scanner host as untrusted-code
  execution territory.
- **PHP, Python, shell and HTML are static-only** — they are never executed,
  so purely runtime-decoded payloads in those languages can evade detection
  (their decode chains are flagged statically, but not observed live).
- **Executables are not content-inspected.** PE/ELF/Mach-O/class/WASM files
  are fingerprinted and string-scanned, then honestly reported as
  uninspected, forcing `incomplete`. If the marketplace accepts binary
  products, they need human review or a dedicated AV engine.
- **7z and RAR cannot be opened** (no stdlib/pure-JS reader within the
  dependency constraints) — archives in those formats are reported
  `incomplete`, never passed as clean.
- **ZIP64 archives with hostile entry names**: the built-in fallback reader
  does not parse ZIP64; such an archive falls back to yauzl, which aborts on
  the hostile name — the archive layer reports `failed` and the verdict is
  `incomplete`. Still never a false "clean".
- **OSV checks** (when enabled) cover only exact-pinned versions and depend
  on a third-party API; outages degrade the layer to `unavailable`, they do
  not fail scans.
- Encrypted archives/entries are uninspectable by design and reported as
  such. Sellers should be told to upload unencrypted archives.
- The scanner reports; it does not decide. Recommended marketplace policy:
  `dangerous` → block automatically; `warning`/`incomplete` → hold for
  manual admin review (which matches NORDEVA's current veto-only moderation
  guard: an `infected`-equivalent critical verdict blocks, everything else
  suspicious waits for a human).
