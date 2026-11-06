// Sandbox layer (parent side).
//
// Eligible files: plain browser/node scripts (.js/.mjs/.cjs) up to the size
// cap that parse as a script and do not use import/export/require (those are
// module graphs, not single files — running them file-by-file would produce
// noise, so the skip and its reason are recorded instead).
//
// Each eligible file runs in its OWN child node process:
//   node --max-old-space-size=64 sandbox-runner.js
// with a scrubbed environment (PATH only), an empty temporary cwd, source
// delivered over stdin (the file is never required as a module), and a hard
// 2500ms wall-clock kill. stdout is parsed as JSON behaviour lines.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SandboxBehavior } from "./types";

export const SANDBOX_WALL_MS = 2500;

export function sandboxSkipReason(source: string, sizeBytes: number, capBytes: number): string | null {
  if (sizeBytes > capBytes) return `file exceeds sandbox size cap (${capBytes} bytes)`;
  if (/^\s*import[\s('"]/m.test(source) || /\bimport\s*\(/.test(source)) return "file uses ES module imports";
  if (/^\s*export[\s{*]/m.test(source)) return "file uses ES module exports";
  if (/\brequire\s*\(/.test(source)) return "file uses CommonJS require() calls";
  return null;
}

export interface SandboxRunOutcome {
  behaviors: SandboxBehavior[];
  note: string | null;
}

export async function runInSandbox(file: string, source: string): Promise<SandboxRunOutcome> {
  const runnerPath = path.join(__dirname, "sandbox-runner.js");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "shield-sbx-"));
  try {
    return await new Promise<SandboxRunOutcome>((resolve) => {
      let stdout = "";
      let killed = false;
      const child = spawn(process.execPath, ["--max-old-space-size=64", runnerPath], {
        cwd,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, SANDBOX_WALL_MS);
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString("utf8");
        if (stdout.length > 1024 * 1024) stdout = stdout.slice(-1024 * 1024);
      });
      child.stderr.on("data", () => undefined);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ behaviors: [], note: `sandbox process failed to start: ${err.message}` });
      });
      child.on("close", () => {
        clearTimeout(timer);
        const behaviors: SandboxBehavior[] = [];
        let errored: string | null = null;
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as { b?: { kind: string; detail: string }; error?: string };
            if (obj.b) behaviors.push({ file, kind: obj.b.kind, detail: obj.b.detail });
            if (obj.error) errored = obj.error;
          } catch {
            /* partial line on kill — ignore */
          }
        }
        if (killed) {
          behaviors.push({ file, kind: "timeout", detail: `sandbox killed after ${SANDBOX_WALL_MS}ms wall clock` });
        } else if (errored) {
          behaviors.push({ file, kind: "note", detail: `sandbox runner reported: ${errored}` });
        }
        resolve({ behaviors, note: killed ? "sandbox timeout" : null });
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(JSON.stringify({ source }));
    });
  } finally {
    try {
      fs.rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
}
