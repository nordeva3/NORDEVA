// Sandbox runner — executed as a standalone child process, one per file.
//
// The untrusted source arrives as JSON on stdin: { "source": "..." }.
// It runs inside node:vm with a frozen, instrumented global surface:
// network APIs, document.cookie, web storage, clipboard etc. are stubs that
// RECORD the attempt and return harmless dummies. Behaviours are printed as
// JSON lines on stdout: {"b":{"kind":"network","detail":"fetch https://…"}}
//
// Isolation: this process is spawned with a scrubbed environment, an empty
// temp cwd, a 64MB heap cap and a hard wall-clock kill from the parent (plus
// a self-watchdog here). node:vm is NOT a perfect security boundary — the
// process/container layers are what contain an escape; see README.

import * as vm from "node:vm";

interface BehaviorMsg {
  kind: string;
  detail: string;
}

const behaviors: BehaviorMsg[] = [];
function record(kind: string, detail: string): void {
  if (behaviors.length < 500) behaviors.push({ kind, detail: detail.slice(0, 300) });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main(): Promise<void> {
  // Watchdog: whatever the target does, this process ends.
  const watchdog = setTimeout(() => {
    flush();
    process.exit(0);
  }, 2100);

  let source = "";
  try {
    const input = JSON.parse(await readStdin()) as { source?: string };
    source = typeof input.source === "string" ? input.source : "";
  } catch {
    process.stdout.write(JSON.stringify({ error: "bad input" }) + "\n");
    clearTimeout(watchdog);
    return;
  }

  // ---- Instrumented stubs -------------------------------------------------
  let timerCount = 0;
  const MAX_TIMERS = 300;
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  const storageStub = (store: Map<string, string>, label: string) => ({
    getItem: (k: string) => {
      record("storage-read", `${label}:${String(k)}`);
      return store.get(String(k)) ?? null;
    },
    setItem: (k: string, v: string) => {
      record("storage-write", `${label}:${String(k)}`);
      store.set(String(k), String(v));
    },
    removeItem: (k: string) => store.delete(String(k)),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });

  const documentStub: Record<string, unknown> = {
    createElement: (tag: string) => ({
      tagName: String(tag).toUpperCase(),
      style: {},
      children: [],
      setAttribute: () => undefined,
      appendChild: () => undefined,
      addEventListener: () => undefined,
    }),
    createTextNode: (t: string) => ({ textContent: String(t) }),
    querySelector: (sel: string) => {
      record("dom-query", String(sel).slice(0, 120));
      return null;
    },
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByTagName: () => [],
    addEventListener: (ev: string) => record("listener", String(ev)),
    body: { appendChild: () => undefined, addEventListener: () => undefined },
    head: { appendChild: () => undefined },
    documentElement: { style: {} },
    location: { href: "https://sandbox.invalid/", hostname: "sandbox.invalid" },
    referrer: "",
    title: "",
  };
  Object.defineProperty(documentStub, "cookie", {
    get() {
      record("cookie-read", "document.cookie");
      return "";
    },
    set(v: unknown) {
      record("cookie-write", String(v).slice(0, 160));
    },
    enumerable: true,
  });

  const sandbox: Record<string, unknown> = {
    console: {
      log: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
    setTimeout: (fn: (...a: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (++timerCount > MAX_TIMERS) return 0 as unknown as NodeJS.Timeout;
      return setTimeout(() => {
        try { fn(...args); } catch (e) { record("error", `timer: ${(e as Error).message}`.slice(0, 160)); }
      }, Math.min(typeof delay === "number" ? delay : 0, 10));
    },
    setInterval: (fn: (...a: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (++timerCount > MAX_TIMERS) return 0 as unknown as NodeJS.Timeout;
      let fires = 0;
      const id = setInterval(() => {
        if (++fires > 20) {
          clearInterval(id);
          return;
        }
        try { fn(...args); } catch (e) { record("error", `interval: ${(e as Error).message}`.slice(0, 160)); }
      }, Math.max(1, Math.min(typeof delay === "number" ? delay : 1, 10)));
      return id;
    },
    clearTimeout: (id: NodeJS.Timeout) => clearTimeout(id),
    clearInterval: (id: NodeJS.Timeout) => clearInterval(id),
    queueMicrotask: (fn: () => void) => queueMicrotask(fn),
    fetch: (url: unknown) => {
      record("network", `fetch ${String(url)}`);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "",
        headers: { get: () => null },
      });
    },
    XMLHttpRequest: class {
      open(method: string, url: string) {
        record("network", `xhr ${method} ${String(url)}`);
      }
      send() { /* dummy */ }
      setRequestHeader() { /* dummy */ }
      addEventListener() { /* dummy */ }
    },
    WebSocket: class {
      constructor(url: string) {
        record("network", `websocket ${String(url)}`);
      }
      send() { /* dummy */ }
      close() { /* dummy */ }
      addEventListener() { /* dummy */ }
    },
    navigator: {
      userAgent: "Mozilla/5.0 (sandbox)",
      sendBeacon: (url: unknown) => {
        record("network", `sendBeacon ${String(url)}`);
        return true;
      },
      clipboard: {
        readText: async () => {
          record("clipboard-read", "navigator.clipboard.readText");
          return "";
        },
        writeText: async () => undefined,
      },
    },
    document: documentStub,
    localStorage: storageStub(localStore, "localStorage"),
    sessionStorage: storageStub(sessionStore, "sessionStorage"),
    location: { href: "https://sandbox.invalid/", hostname: "sandbox.invalid", assign: (u: string) => record("navigation", String(u)) },
    atob: (s: string) => {
      record("decode", "atob");
      return Buffer.from(s, "base64").toString("binary");
    },
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    Buffer,
    URL,
    TextEncoder,
    TextDecoder,
    Promise,
    JSON,
    Math,
    Date,
    __record: record,
  };

  const context = vm.createContext(sandbox, {
    name: "nordeva-shield-sandbox",
    microtaskMode: "afterEvaluate",
  });

  // Wrap eval / Function inside the realm so use is recorded, then allowed.
  try {
    vm.runInContext(
      `(() => {
         const r = globalThis.__record;
         const origEval = globalThis.eval;
         globalThis.eval = function (code) { r('eval', String(code).slice(0, 160)); return origEval(code); };
         const OrigFunction = globalThis.Function;
         const WrappedFunction = function (...args) { r('function-ctor', String(args[args.length - 1] || '').slice(0, 160)); return OrigFunction(...args); };
         WrappedFunction.prototype = OrigFunction.prototype;
         globalThis.Function = WrappedFunction;
         globalThis.window = globalThis;
         globalThis.self = globalThis;
         delete globalThis.__record;
       })();`,
      context,
    );
  } catch {
    /* bootstrap failure is non-fatal */
  }
  sandbox.__record = record; // keep a host-side handle for the stubs above

  try {
    vm.runInContext(source, context, { timeout: 1800, filename: "upload.js" });
  } catch (e) {
    const err = e as Error;
    if (/timed out/.test(err.message)) record("timeout", "synchronous execution exceeded vm timeout");
    else record("error", `uncaught: ${err.message}`.slice(0, 200));
  }

  // Let accelerated timers / promise chains surface their behaviour.
  await new Promise((r) => setTimeout(r, 350));
  clearTimeout(watchdog);
  flush();
}

function flush(): void {
  for (const b of behaviors) {
    process.stdout.write(JSON.stringify({ b }) + "\n");
  }
  process.stdout.write(JSON.stringify({ done: true }) + "\n");
}

void main();
