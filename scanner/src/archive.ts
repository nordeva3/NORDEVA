// Archive layer: safe expansion of ZIP / tar / gzip containers.
//
// Safety properties:
//  - Type is sniffed from magic bytes, never from the claimed file name.
//  - Nothing is ever written to disk: entries are read into memory under
//    hard global budgets, so zip-slip / path traversal cannot touch the FS.
//  - Traversal-style entry names ("../", absolute paths) are still recorded
//    as suspicious findings — the uploader tried, even though it cannot work.
//  - Compression-ratio bombs, oversized entries, excess entry counts and
//    excess total size stop expansion of the offending entry/subtree and are
//    recorded in `limitsHit` plus the per-file coverage record. An entry we
//    could not fully read is NEVER silently treated as clean.
//
// ZIP reading: yauzl is the primary reader. One hostile entry name makes
// yauzl abort the WHOLE archive (its validateFileName is not configurable),
// which would blind the scanner to every other entry — so archives whose
// central directory contains hostile names are read with the built-in
// central-directory reader below instead. Both paths feed the same
// per-entry processor, so limits and findings are identical.

import * as zlib from "node:zlib";
import yauzl from "yauzl";
import type { Finding, ScanLimits } from "./types";
import { sanitizeEntryPath } from "./util";
import { sniffKind } from "./signatures";

export interface ExtractedItem {
  /** Display path; nested members are joined with "!". */
  path: string;
  /** File content, or null when no content could be obtained. */
  buf: Buffer | null;
  /** Declared/actual full size in bytes (may exceed buf.length if truncated). */
  size: number;
  /** True when this item was a container that we expanded into children. */
  containerExpanded?: boolean;
  /** True when buf holds only a prefix of the real content. */
  truncated?: boolean;
  /** Why buf is null (encrypted, bomb, read error, limits...). */
  noContentReason?: string;
}

export interface ArchiveResult {
  items: ExtractedItem[];
  entriesTotal: number;
  notes: string[];
  limitsHit: string[];
  findings: Finding[];
  /** A container at some level failed to parse at all. */
  anyFailure: boolean;
  /** At least one limit or partial-read condition was hit. */
  limited: boolean;
}

interface Ctx {
  limits: ScanLimits;
  entries: number;
  totalUncompressed: number;
  stopped: boolean;
  items: ExtractedItem[];
  notes: string[];
  limitsHit: string[];
  findings: Finding[];
  anyFailure: boolean;
  limited: boolean;
}

function isContainerKind(kind: string): boolean {
  return kind === "zip" || kind === "gzip" || kind === "tar";
}

function isUnsupportedArchive(kind: string): boolean {
  return kind === "7z" || kind === "rar";
}

export async function expandArchive(
  buf: Buffer,
  fileName: string,
  limits: ScanLimits,
): Promise<ArchiveResult> {
  const ctx: Ctx = {
    limits,
    entries: 0,
    totalUncompressed: 0,
    stopped: false,
    items: [],
    notes: [],
    limitsHit: [],
    findings: [],
    anyFailure: false,
    limited: false,
  };
  const kind = sniffKind(buf);
  if (isContainerKind(kind)) {
    await expandContainer(buf, fileName, 0, ctx);
  } else if (isUnsupportedArchive(kind)) {
    ctx.items.push({
      path: fileName,
      buf,
      size: buf.length,
      noContentReason: undefined,
    });
    ctx.notes.push(`top-level asset is a ${kind} archive, which this scanner cannot open`);
    ctx.entries = 1;
  } else {
    ctx.items.push({ path: fileName, buf, size: buf.length });
    ctx.entries = 1;
  }
  return {
    items: ctx.items,
    entriesTotal: ctx.entries,
    notes: ctx.notes,
    limitsHit: ctx.limitsHit,
    findings: ctx.findings,
    anyFailure: ctx.anyFailure,
    limited: ctx.limited,
  };
}

function hitLimit(ctx: Ctx, label: string) {
  if (!ctx.limitsHit.includes(label)) ctx.limitsHit.push(label);
  ctx.limited = true;
}

/** Returns false when global budgets are exhausted and expansion must stop. */
function budgetFor(ctx: Ctx, displayPath: string): boolean {
  if (ctx.stopped) return false;
  ctx.entries++;
  if (ctx.entries > ctx.limits.maxEntries) {
    hitLimit(ctx, "max-entries");
    ctx.notes.push(`entry budget (${ctx.limits.maxEntries}) exhausted at ${displayPath}`);
    ctx.stopped = true;
    return false;
  }
  return true;
}

async function expandContainer(buf: Buffer, name: string, depth: number, ctx: Ctx): Promise<void> {
  const kind = sniffKind(buf);
  try {
    if (kind === "zip") {
      await expandZip(buf, name, depth, ctx);
    } else if (kind === "gzip") {
      const inner = await gunzipCapped(buf, ctx.limits.maxTotalUncompressed, ctx);
      if (inner === null) {
        ctx.items.push({ path: name, buf: null, size: buf.length, noContentReason: "gzip stream could not be decompressed within limits" });
        ctx.anyFailure = true;
        return;
      }
      const innerName = name.replace(/\.(tgz|gz)$/i, "") || name;
      if (sniffKind(inner) === "tar") {
        await expandTar(inner, name, depth, ctx);
      } else {
        await emitLeaf(inner, innerName === name ? `${name} (decompressed)` : innerName, depth, ctx, name);
      }
    } else if (kind === "tar") {
      await expandTar(buf, name, depth, ctx);
    }
  } catch (err) {
    ctx.anyFailure = true;
    ctx.notes.push(`failed to open archive ${name}: ${(err as Error).message}`);
    ctx.items.push({ path: name, buf: null, size: buf.length, noContentReason: `archive parse failure: ${(err as Error).message}` });
  }
}

/**
 * Emit one leaf file. If the leaf is itself a container and depth allows,
 * expand it (recording the container as an inspected item too).
 */
async function emitLeaf(
  buf: Buffer,
  displayPath: string,
  depth: number,
  ctx: Ctx,
  containerPathForChildren: string,
): Promise<void> {
  const kind = sniffKind(buf);
  if ((isContainerKind(kind) || isUnsupportedArchive(kind)) && depth < ctx.limits.maxDepth) {
    if (isUnsupportedArchive(kind)) {
      ctx.items.push({ path: displayPath, buf, size: buf.length });
      ctx.notes.push(`${displayPath}: ${kind} archive cannot be opened by this scanner`);
      return;
    }
    ctx.items.push({ path: displayPath, buf: null, size: buf.length, containerExpanded: true });
    await expandContainer(buf, containerPathForChildren, depth + 1, ctx);
    return;
  }
  if (isContainerKind(kind) && depth >= ctx.limits.maxDepth) {
    ctx.items.push({
      path: displayPath,
      buf,
      size: buf.length,
      noContentReason: "nested archive beyond maximum depth was not expanded",
    });
    hitLimit(ctx, `max-depth:${displayPath}`);
    return;
  }
  ctx.items.push({ path: displayPath, buf, size: buf.length });
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface ZipEntryMeta {
  rawName: string;
  isDir: boolean;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

type EntryContent = { buf: Buffer; fullSize: number; truncated: boolean };

async function processZipEntry(
  meta: ZipEntryMeta,
  read: () => Promise<EntryContent | null>,
  containerName: string,
  depth: number,
  ctx: Ctx,
): Promise<void> {
  const { path: clean, traversal } = sanitizeEntryPath(meta.rawName);
  const displayPath = `${containerName}!${clean}`;

  if (!budgetFor(ctx, displayPath)) {
    ctx.items.push({ path: displayPath, buf: null, size: meta.uncompressedSize, noContentReason: "scan limits reached before this entry could be read" });
    return;
  }
  if (meta.isDir) return;

  if (traversal) {
    ctx.findings.push({
      rule_id: "ARCHIVE_PATH_TRAVERSAL",
      severity: "medium",
      file: displayPath,
      line: null,
      message: `Archive entry name "${meta.rawName}" attempts path traversal. Entries are only ever read into memory, so nothing was written to disk.`,
    });
  }

  if (meta.encrypted) {
    ctx.items.push({ path: displayPath, buf: null, size: meta.uncompressedSize, noContentReason: "encrypted zip entry cannot be inspected" });
    ctx.findings.push({
      rule_id: "ARCHIVE_ENCRYPTED_ENTRY",
      severity: "info",
      file: displayPath,
      line: null,
      message: "Encrypted archive entry cannot be inspected; it is counted as uninspected, not as clean.",
    });
    ctx.limited = true;
    return;
  }

  const declared = meta.uncompressedSize;
  // Compression-ratio bomb check happens from the directory alone, before a
  // single byte of the entry is decompressed.
  if (meta.compressedSize > 0 && declared / meta.compressedSize > ctx.limits.maxRatio && declared > 1024 * 1024) {
    hitLimit(ctx, `ratio:${displayPath}`);
    ctx.items.push({ path: displayPath, buf: null, size: declared, noContentReason: `compression ratio ${(declared / meta.compressedSize).toFixed(0)}:1 exceeds limit ${ctx.limits.maxRatio}:1 (possible archive bomb); entry was not expanded` });
    ctx.findings.push({
      rule_id: "ARCHIVE_BOMB_RATIO",
      severity: "high",
      file: displayPath,
      line: null,
      message: `Entry expands ${(declared / meta.compressedSize).toFixed(0)}x (limit ${ctx.limits.maxRatio}x) — characteristic of a zip bomb. Expansion refused.`,
    });
    return;
  }

  const content = await read();
  if (content === null) {
    ctx.items.push({ path: displayPath, buf: null, size: declared, noContentReason: "entry content could not be read" });
    ctx.limited = true;
    return;
  }
  ctx.totalUncompressed += content.fullSize;
  if (ctx.totalUncompressed > ctx.limits.maxTotalUncompressed) {
    hitLimit(ctx, "max-total-uncompressed");
    ctx.stopped = true;
  }
  if (content.truncated) {
    ctx.items.push({ path: displayPath, buf: content.buf, size: declared, truncated: true });
    hitLimit(ctx, `entry-size:${displayPath}`);
    return;
  }
  await emitLeaf(content.buf, displayPath, depth + 1, ctx, displayPath);
}

/** Names yauzl would refuse (and abort the whole archive over). */
function isHostileName(rawName: string): boolean {
  return rawName.includes("\\") || sanitizeEntryPath(rawName).traversal;
}

async function expandZip(buf: Buffer, name: string, depth: number, ctx: Ctx): Promise<void> {
  const cd = parseCentralDirectory(buf);
  if (cd && cd.some((e) => isHostileName(e.name))) {
    ctx.notes.push(
      `${name}: archive contains hostile entry names; read with the built-in central-directory reader because yauzl aborts the entire archive on such names`,
    );
    for (const entry of cd) {
      if (ctx.stopped) break;
      try {
        await processZipEntry(
          {
            rawName: entry.name,
            isDir: /\/$/.test(entry.name),
            encrypted: (entry.flags & 0x1) !== 0,
            compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize,
          },
          () => readCdEntry(buf, entry, ctx),
          name,
          depth,
          ctx,
        );
      } catch (err) {
        ctx.limited = true;
        ctx.notes.push(`error reading entry ${entry.name} in ${name}: ${(err as Error).message}`);
      }
    }
    return;
  }

  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, validateEntrySizes: true, strictFileNames: false }, (err, zf) => {
      if (err || !zf) reject(err ?? new Error("could not open zip"));
      else resolve(zf);
    });
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        try { zip.close(); } catch { /* already closed */ }
        resolve();
      }
    };
    zip.on("error", (err: Error) => {
      ctx.anyFailure = true;
      ctx.notes.push(`zip error in ${name}: ${err.message}`);
      done();
    });
    zip.on("end", done);
    zip.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        try {
          await processZipEntry(
            {
              rawName: entry.fileName,
              isDir: /\/$/.test(entry.fileName),
              encrypted: entry.isEncrypted(),
              compressedSize: entry.compressedSize,
              uncompressedSize: entry.uncompressedSize,
            },
            () => readYauzlEntry(zip, entry, ctx),
            name,
            depth,
            ctx,
          );
        } catch (err) {
          ctx.limited = true;
          ctx.notes.push(`error reading entry ${entry.fileName} in ${name}: ${(err as Error).message}`);
        } finally {
          if (ctx.stopped) done();
          else zip.readEntry();
        }
      })();
    });
    zip.readEntry();
  });
}

function readYauzlEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  ctx: Ctx,
): Promise<EntryContent | null> {
  return new Promise((resolve) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      let kept = 0;
      let fullSize = 0;
      let truncated = false;
      stream.on("data", (chunk: Buffer) => {
        fullSize += chunk.length;
        if (kept + chunk.length <= ctx.limits.maxEntryBytes) {
          chunks.push(chunk);
          kept += chunk.length;
        } else if (kept < ctx.limits.maxEntryBytes) {
          const room = ctx.limits.maxEntryBytes - kept;
          chunks.push(chunk.subarray(0, room));
          kept += room;
          truncated = true;
        } else {
          truncated = true;
        }
      });
      stream.on("end", () => resolve({ buf: Buffer.concat(chunks), fullSize, truncated }));
      stream.on("error", () => resolve(null));
    });
  });
}

// --- Built-in central-directory reader (fallback for hostile names) --------

interface CdEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function parseCentralDirectory(buf: Buffer): CdEntry[] | null {
  // Locate the End Of Central Directory record (last 64KiB + 22 bytes).
  const minPos = Math.max(0, buf.length - (65536 + 22));
  let eocd = -1;
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return null; // zip64 — yauzl path handles it
  const entries: CdEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) return null;
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800) !== 0 ? nameBytes.toString("utf8") : nameBytes.toString("latin1");
    entries.push({ name, flags, method, crc, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32Local(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function inflateCapped(raw: Buffer, cap: number): Promise<{ buf: Buffer; truncated: boolean } | null> {
  return new Promise((resolve) => {
    const inf = zlib.createInflateRaw();
    const chunks: Buffer[] = [];
    let kept = 0;
    let truncated = false;
    inf.on("data", (chunk: Buffer) => {
      if (kept + chunk.length <= cap) {
        chunks.push(chunk);
        kept += chunk.length;
      } else if (kept < cap) {
        chunks.push(chunk.subarray(0, cap - kept));
        kept = cap;
        truncated = true;
      } else {
        truncated = true;
      }
    });
    inf.on("end", () => resolve({ buf: Buffer.concat(chunks), truncated }));
    inf.on("error", () => resolve(null));
    inf.end(raw);
  });
}

async function readCdEntry(buf: Buffer, entry: CdEntry, ctx: Ctx): Promise<EntryContent | null> {
  const off = entry.localOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const dataEnd = Math.min(dataStart + entry.compressedSize, buf.length);
  if (dataStart > dataEnd) return null;
  const raw = buf.subarray(dataStart, dataEnd);

  if (entry.method === 0) {
    const truncated = raw.length > ctx.limits.maxEntryBytes;
    const out = truncated ? raw.subarray(0, ctx.limits.maxEntryBytes) : raw;
    if (!truncated && crc32Local(out) !== entry.crc) return null;
    return { buf: Buffer.from(out), fullSize: entry.uncompressedSize, truncated };
  }
  if (entry.method === 8) {
    const res = await inflateCapped(raw, ctx.limits.maxEntryBytes);
    if (res === null) return null;
    if (!res.truncated && crc32Local(res.buf) !== entry.crc) return null;
    return { buf: res.buf, fullSize: entry.uncompressedSize, truncated: res.truncated };
  }
  ctx.notes.push(`entry ${entry.name} uses unsupported zip compression method ${entry.method}`);
  return null;
}

async function gunzipCapped(buf: Buffer, cap: number, ctx: Ctx): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const gun = zlib.createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    gun.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        overflow = true;
        hitLimit(ctx, "gzip-output-cap");
        gun.destroy();
        return;
      }
      chunks.push(chunk);
    });
    gun.on("end", () => resolve(overflow ? null : Buffer.concat(chunks)));
    gun.on("error", () => resolve(null));
    gun.end(buf);
  });
}

// ---------------------------------------------------------------------------
// Minimal ustar reader (POSIX ustar + GNU longname + pax path records).
// ---------------------------------------------------------------------------

interface TarEntry {
  name: string;
  size: number;
  typeflag: string;
  data: Buffer;
}

function parseTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;

  const readStr = (start: number, len: number): string =>
    buf.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "");

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    let name = readStr(offset, 100);
    const sizeRaw = readStr(offset + 124, 12).trim();
    const size = Number.parseInt(sizeRaw || "0", 8);
    if (!Number.isFinite(size) || size < 0) break;
    const typeflag = String.fromCharCode(buf[offset + 156]);
    const magic = readStr(offset + 257, 5);
    if (magic === "ustar") {
      const prefix = readStr(offset + 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const dataStart = offset + 512;
    const dataEnd = Math.min(dataStart + size, buf.length);
    const data = buf.subarray(dataStart, dataEnd);

    if (typeflag === "L") {
      longName = data.toString("utf8").replace(/\0.*$/s, "");
    } else if (typeflag === "x") {
      // pax extended header: sequence of "<len> <key>=<value>\n"
      const text = data.toString("utf8");
      const m = /(?:^|\n)\d+ path=(.*)/.exec(text);
      if (m) paxPath = m[1].split("\n")[0];
    } else {
      entries.push({ name: paxPath ?? longName ?? name, size, typeflag, data: Buffer.from(data) });
      longName = null;
      paxPath = null;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function expandTar(buf: Buffer, name: string, depth: number, ctx: Ctx): Promise<void> {
  const entries = parseTar(buf);
  if (entries.length === 0 && buf.length > 1024) {
    ctx.anyFailure = true;
    ctx.notes.push(`tar archive ${name} produced no readable entries`);
  }
  for (const entry of entries) {
    if (entry.typeflag === "5") continue; // directory
    const { path: clean, traversal } = sanitizeEntryPath(entry.name);
    const displayPath = `${name}!${clean}`;
    if (!budgetFor(ctx, displayPath)) {
      ctx.items.push({ path: displayPath, buf: null, size: entry.size, noContentReason: "scan limits reached before this entry could be read" });
      continue;
    }
    if (traversal) {
      ctx.findings.push({
        rule_id: "ARCHIVE_PATH_TRAVERSAL",
        severity: "medium",
        file: displayPath,
        line: null,
        message: `Archive entry name "${entry.name}" attempts path traversal. Entries are only ever read into memory, so nothing was written to disk.`,
      });
    }
    ctx.totalUncompressed += entry.data.length;
    if (ctx.totalUncompressed > ctx.limits.maxTotalUncompressed) {
      hitLimit(ctx, "max-total-uncompressed");
      ctx.items.push({ path: displayPath, buf: null, size: entry.size, noContentReason: "total uncompressed size budget exhausted" });
      ctx.stopped = true;
      continue;
    }
    if (entry.data.length >= ctx.limits.maxEntryBytes) {
      ctx.items.push({ path: displayPath, buf: entry.data.subarray(0, ctx.limits.maxEntryBytes), size: entry.size, truncated: true });
      hitLimit(ctx, `entry-size:${displayPath}`);
      continue;
    }
    await emitLeaf(entry.data, displayPath, depth + 1, ctx, displayPath);
  }
}
