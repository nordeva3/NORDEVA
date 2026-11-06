// Shared types for the NORDEVA Shield scan report.
//
// The REPORT object produced here is exactly the `findings` field of the
// POST /scan response described in the service contract.

export type Verdict = "safe" | "warning" | "dangerous" | "incomplete";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  rule_id: string;
  severity: Severity;
  file: string | null;
  line: number | null;
  message: string;
  snippet?: string;
  /** True when this finding is a known-signature / confirmed-pattern hit. */
  signature?: boolean;
}

export interface FileRecord {
  path: string;
  size: number;
  type: string;
  inspected: boolean;
  layers: string[];
  skipped_reason?: string;
}

export interface ArchiveLayer {
  status: "ok" | "limited" | "failed";
  notes: string[];
}

export interface StaticLayer {
  status: "ok" | "partial" | "skipped";
  files_analyzed: number;
}

export interface SignaturesLayer {
  status: "ok" | "skipped";
  hits: string[];
}

export interface DepIssue {
  file: string;
  message: string;
  severity: Severity;
}

export interface DependenciesLayer {
  status: "ok" | "disabled" | "unavailable";
  manifests: number;
  issues: DepIssue[];
}

export interface SandboxBehavior {
  file: string;
  kind: string;
  detail: string;
}

export interface SandboxLayer {
  status: "ok" | "skipped";
  files_run: number;
  behaviors: SandboxBehavior[];
}

export interface ScanReport {
  verdict: Verdict;
  rules_version: string;
  duration_ms: number;
  sha256_match: boolean;
  size_bytes: number;
  coverage: {
    entries_total: number;
    files_total: number;
    files_inspected: number;
    files_skipped: number;
  };
  files: FileRecord[];
  findings: Finding[];
  layers: {
    archive: ArchiveLayer;
    static: StaticLayer;
    signatures: SignaturesLayer;
    dependencies: DependenciesLayer;
    sandbox: SandboxLayer;
  };
  limits_hit: string[];
}

export interface ScanLimits {
  maxDownloadBytes: number;
  maxEntries: number;
  maxTotalUncompressed: number;
  maxEntryBytes: number;
  maxDepth: number;
  maxRatio: number;
  /** Max size of a text file that receives full static analysis. */
  textAnalysisCap: number;
  /** Max size of a JS file eligible for the sandbox. */
  sandboxMaxBytes: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadLimits(): ScanLimits {
  return {
    maxDownloadBytes: envInt("SCAN_MAX_DOWNLOAD_BYTES", 128 * 1024 * 1024),
    maxEntries: envInt("SCAN_MAX_ENTRIES", 2000),
    maxTotalUncompressed: envInt("SCAN_MAX_TOTAL_UNCOMPRESSED", 256 * 1024 * 1024),
    maxEntryBytes: envInt("SCAN_MAX_ENTRY_BYTES", 64 * 1024 * 1024),
    maxDepth: envInt("SCAN_MAX_DEPTH", 3),
    maxRatio: envInt("SCAN_MAX_RATIO", 100),
    textAnalysisCap: envInt("SCAN_TEXT_ANALYSIS_CAP", 8 * 1024 * 1024),
    sandboxMaxBytes: envInt("SCAN_SANDBOX_MAX_BYTES", 256 * 1024),
  };
}
