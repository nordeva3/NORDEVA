// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

// Node runtime hardening: a single fire-and-forget promise that rejects
// while the backend is unreachable (for example a background Supabase call)
// must not terminate the whole server process for every visitor. Log and
// record it instead; request handlers still surface their own errors.
const nodeProcess = (globalThis as { process?: NodeJS.Process }).process;
if (
  nodeProcess?.on &&
  !(globalThis as { __veloraRejectionGuard?: boolean }).__veloraRejectionGuard
) {
  (globalThis as { __veloraRejectionGuard?: boolean }).__veloraRejectionGuard = true;
  nodeProcess.on("unhandledRejection", (reason) => {
    record(reason);
    console.error("[server] Unhandled promise rejection (server kept alive):", reason);
  });
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
