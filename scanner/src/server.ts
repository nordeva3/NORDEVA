// NORDEVA Shield — HTTP layer (deliberately thin; all logic lives in
// engine.ts so the pipeline can be unit-tested without a server).
//
// POST /scan contract (from the marketplace app):
//   body: { listing_id, asset_id, path, file_name, mime_type, file_size, sha256 }
//   auth: Authorization: Bearer <SCANNER_TOKEN>
//   200:  { status, scanner_version, signature, findings: REPORT }
// File content problems never produce a 500 — they produce a verdict.
// 500 is reserved for genuine internal faults (misconfiguration, bugs).

import * as http from "node:http";
import * as crypto from "node:crypto";
import { scanBuffer, primarySignature, skeletonReport } from "./engine";
import { loadLimits } from "./types";
import { sha256Hex } from "./util";
import { RULES_VERSION, SCANNER_VERSION } from "./signatures";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const SCANNER_TOKEN = process.env.SCANNER_TOKEN ?? "";
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = "listing-files";

if (!SCANNER_TOKEN) {
  console.error("FATAL: SCANNER_TOKEN is not set. Refusing to start an unauthenticated scanner.");
  process.exit(1);
}

const limits = loadLimits();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function tokenOk(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${SCANNER_TOKEN}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req: http.IncomingMessage, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > cap) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

interface ScanRequest {
  listing_id: string;
  asset_id: string;
  path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
}

function validateScanRequest(v: unknown): ScanRequest | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" && (o[k] as string).length > 0 ? (o[k] as string) : null);
  const listing_id = str("listing_id");
  const asset_id = str("asset_id");
  const objPath = str("path");
  const file_name = str("file_name");
  const mime_type = str("mime_type");
  const sha = str("sha256");
  const file_size = typeof o.file_size === "number" && Number.isFinite(o.file_size) && o.file_size >= 0 ? o.file_size : null;
  if (!listing_id || !asset_id || !objPath || !file_name || !mime_type || !sha || file_size === null) return null;
  if (!/^[a-f0-9]{64}$/i.test(sha)) return null;
  if (objPath.includes("..")) return null;
  return { listing_id, asset_id, path: objPath, file_name, mime_type, file_size, sha256: sha.toLowerCase() };
}

/** Download a storage object with a hard size cap. */
async function downloadObject(
  objPath: string,
): Promise<{ kind: "ok"; buf: Buffer } | { kind: "too-large"; received: number } | { kind: "http-error"; status: number }> {
  const encoded = objPath.split("/").map(encodeURIComponent).join("/");
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encoded}`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok || !res.body) return { kind: "http-error", status: res.status };
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limits.maxDownloadBytes) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too-large", received: total };
    }
    chunks.push(Buffer.from(value));
  }
  return { kind: "ok", buf: Buffer.concat(chunks) };
}

async function handleScan(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!tokenOk(req)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  let parsed: unknown;
  try {
    const raw = await readBody(req, 64 * 1024);
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    json(res, 400, { error: "malformed JSON body" });
    return;
  }
  const scanReq = validateScanRequest(parsed);
  if (!scanReq) {
    json(res, 400, { error: "invalid scan request: expected {listing_id, asset_id, path, file_name, mime_type, file_size, sha256}" });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    json(res, 500, { error: "scanner is not configured with SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  const dl = await downloadObject(scanReq.path);
  if (dl.kind === "http-error") {
    json(res, dl.status === 404 ? 404 : 502, { error: `could not download asset from storage (HTTP ${dl.status})` });
    return;
  }
  if (dl.kind === "too-large") {
    const report = skeletonReport({ size_bytes: dl.received, limits_hit: ["max-download"] });
    report.findings = [
      {
        rule_id: "DOWNLOAD_TOO_LARGE",
        severity: "high",
        file: scanReq.file_name,
        line: null,
        message: `Asset exceeds the maximum scannable size (${limits.maxDownloadBytes} bytes). It was not scanned at all — treat as uninspected, not clean.`,
      },
    ];
    report.layers.archive.notes.push("download aborted at size cap");
    json(res, 200, { status: report.verdict, scanner_version: SCANNER_VERSION, signature: null, findings: report });
    return;
  }

  const buf = dl.buf;
  const actualSha = sha256Hex(buf);
  if (actualSha !== scanReq.sha256) {
    // Integrity failure: the bytes are not the bytes the marketplace thinks
    // were uploaded. Do not scan further; say so loudly.
    const report = skeletonReport({ size_bytes: buf.length, sha256_match: false });
    report.findings = [
      {
        rule_id: "INTEGRITY_SHA_MISMATCH",
        severity: "critical",
        file: scanReq.file_name,
        line: null,
        message: `SHA-256 mismatch: marketplace recorded ${scanReq.sha256}, downloaded object hashes to ${actualSha}. The file was NOT scanned further.`,
        signature: true,
      },
    ];
    report.layers.signatures = { status: "ok", hits: ["INTEGRITY_SHA_MISMATCH"] };
    json(res, 200, { status: "incomplete", scanner_version: SCANNER_VERSION, signature: "INTEGRITY_SHA_MISMATCH", findings: report });
    return;
  }

  const report = await scanBuffer(buf, { fileName: scanReq.file_name, expectedSha256: scanReq.sha256, limits });
  json(res, 200, {
    status: report.verdict,
    scanner_version: SCANNER_VERSION,
    signature: primarySignature(report),
    findings: report,
  });
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, service: "nordeva-shield", rules_version: RULES_VERSION });
        return;
      }
      if (req.method === "POST" && url.pathname === "/scan") {
        await handleScan(req, res);
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      console.error("internal error:", err);
      if (!res.headersSent) json(res, 500, { error: "internal scanner error" });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`nordeva-shield listening on :${PORT} (rules ${RULES_VERSION})`);
});
