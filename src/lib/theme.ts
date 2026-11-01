// NORDEVA theme engine.
//
// The stored *preference* is "light" | "dark" | "system" (key velora-theme).
// "system" resolves through the OS colour-scheme media query and re-applies
// live when the OS setting changes. The *resolved* theme is what lands on
// the <html> class list ("light"/"dark") — the mechanism components have
// always consumed. First-time visitors (no stored preference) get the dark
// factory default; "system" is an explicit choice, never the default.
// The pre-paint bootstrap in routes/__root.tsx mirrors this resolution.

export type VeloraTheme = "light" | "dark";
export type VeloraThemePreference = VeloraTheme | "system";

const THEME_KEY = "velora-theme";
const THEME_EVENT = "velora-theme-change";
const THEME_PREFERENCE_EVENT = "velora-theme-preference-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(preference: VeloraThemePreference): VeloraTheme {
  if (preference !== "system") return preference;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  }
  return "dark";
}

export function readTheme(): VeloraTheme {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  }
  return "dark";
}

export function applyTheme(theme: VeloraTheme, persist = true): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;

  if (persist) {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Theme still works for the current page if storage is unavailable.
    }
  }

  ensureSystemThemeListener();
  window.dispatchEvent(new CustomEvent<VeloraTheme>(THEME_EVENT, { detail: theme }));
}

export function getSavedThemePreference(): VeloraThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Storage unavailable — fall through to the factory default.
  }
  return "dark";
}

/** The resolved theme for the saved preference (kept for existing callers). */
export function getSavedTheme(): VeloraTheme {
  return resolveTheme(getSavedThemePreference());
}

export function applyThemePreference(preference: VeloraThemePreference, persist = true): void {
  if (typeof document === "undefined") return;
  if (persist) {
    try {
      window.localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Preference still applies for the current page if storage fails.
    }
  }
  // applyTheme re-dispatches the resolved theme; skip its own persist so the
  // stored value stays the *preference* ("system"), not the resolution.
  applyTheme(resolveTheme(preference), false);
  window.dispatchEvent(
    new CustomEvent<VeloraThemePreference>(THEME_PREFERENCE_EVENT, { detail: preference }),
  );
}

let systemListenerInstalled = false;

/** Re-apply live when the OS colour scheme changes — only in system mode. */
function ensureSystemThemeListener(): void {
  if (systemListenerInstalled) return;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  systemListenerInstalled = true;
  const query = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (getSavedThemePreference() === "system") {
      applyTheme(resolveTheme("system"), false);
    }
  };
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
  } else if (typeof query.addListener === "function") {
    // Safari < 14 fallback.
    query.addListener(onChange);
  }
}

export function subscribeToTheme(callback: (theme: VeloraTheme) => void): () => void {
  const listener = (event: Event) => {
    const theme = (event as CustomEvent<VeloraTheme>).detail;
    if (theme === "light" || theme === "dark") callback(theme);
  };
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}

export function subscribeToThemePreference(
  callback: (preference: VeloraThemePreference) => void,
): () => void {
  const listener = (event: Event) => {
    const preference = (event as CustomEvent<VeloraThemePreference>).detail;
    if (preference === "light" || preference === "dark" || preference === "system") {
      callback(preference);
    }
  };
  window.addEventListener(THEME_PREFERENCE_EVENT, listener);
  return () => window.removeEventListener(THEME_PREFERENCE_EVENT, listener);
}
