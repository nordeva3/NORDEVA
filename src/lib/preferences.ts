// NORDEVA per-user appearance preferences (TITANIUM wave T2).
//
// Per-device only: everything lives in localStorage ("velora-preferences").
// There is deliberately no account sync — that would need a user_settings
// table, which is out of scope. The admin appearance config
// (src/lib/appearance.ts) stays canonical for the site's look; these prefs
// layer on top for the current visitor only. Precedence for the settings
// they share (density): an explicit user choice wins on this device,
// otherwise the admin value stands.
//
// Applied through <html> hooks consumed by styles.css:
//   fontScale → inline font-size on <html> (the layout is rem-based)
//   radius    → data-user-radius ("sharp"/"round"; "default" = no override,
//               so the active preset's --radius stands)
//   motion    → data-motion="reduced" (adds reduction on top of the OS
//               prefers-reduced-motion block, which always applies anyway)
//   density   → data-density (shared with the admin gridDensity attribute)
// Theme is NOT stored here — it has its own engine (src/lib/theme.ts).
// Accent is NOT offered per-user: it stays admin-controlled, and under the
// TITANIUM preset it is locked monochrome by design.

import { APPEARANCE_EVENT, getCurrentAppearance } from "./appearance";

export type FontScale = "standard" | "large";
export type RadiusPreference = "default" | "sharp" | "round";
export type MotionPreference = "full" | "reduced";
export type DensityPreference = "comfortable" | "compact";

export interface UserPreferences {
  fontScale: FontScale;
  radius: RadiusPreference;
  motion: MotionPreference;
  /**
   * null = no explicit choice on this device: the site-wide (admin)
   * gridDensity applies. An explicit choice overrides it here only.
   */
  density: DensityPreference | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  fontScale: "standard",
  radius: "default",
  motion: "full",
  density: null,
};

export const PREFERENCES_KEY = "velora-preferences";
const PREFERENCES_EVENT = "velora-preferences-change";

const FONT_SCALES: readonly string[] = ["standard", "large"];
const RADII: readonly string[] = ["default", "sharp", "round"];
const MOTIONS: readonly string[] = ["full", "reduced"];
const DENSITIES: readonly string[] = ["comfortable", "compact"];

let currentPreferences: UserPreferences = DEFAULT_PREFERENCES;
let listenersInstalled = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clamp any untrusted payload into valid preferences. Never throws. */
export function validatePreferences(input: unknown): UserPreferences {
  if (!isRecord(input)) return DEFAULT_PREFERENCES;
  return {
    fontScale: FONT_SCALES.includes(String(input.fontScale))
      ? (input.fontScale as FontScale)
      : DEFAULT_PREFERENCES.fontScale,
    radius: RADII.includes(String(input.radius))
      ? (input.radius as RadiusPreference)
      : DEFAULT_PREFERENCES.radius,
    motion: MOTIONS.includes(String(input.motion))
      ? (input.motion as MotionPreference)
      : DEFAULT_PREFERENCES.motion,
    density: DENSITIES.includes(String(input.density))
      ? (input.density as DensityPreference)
      : null,
  };
}

export function readPreferences(): UserPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    currentPreferences = raw ? validatePreferences(JSON.parse(raw)) : DEFAULT_PREFERENCES;
  } catch {
    currentPreferences = DEFAULT_PREFERENCES;
  }
  return currentPreferences;
}

export function getPreferences(): UserPreferences {
  return currentPreferences;
}

export function applyPreferences(preferences: UserPreferences): void {
  currentPreferences = preferences;
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Font size: scale the root font size; Tailwind spacing/type are rem-based.
  root.style.fontSize = preferences.fontScale === "large" ? "112.5%" : "";

  // Corner radius: "default" removes the attribute so the preset --radius
  // stands; the [data-user-radius] rules in styles.css sit after every
  // preset block so an explicit choice wins.
  if (preferences.radius === "default") {
    delete root.dataset.userRadius;
  } else {
    root.dataset.userRadius = preferences.radius;
  }

  // Motion: only ever ADDS reduction. An OS-level prefers-reduced-motion
  // setting is honoured by the CSS media query regardless of this pref.
  if (preferences.motion === "reduced") {
    root.dataset.motion = "reduced";
  } else {
    delete root.dataset.motion;
  }

  // Density: data-density is shared with the admin appearance system. An
  // explicit user choice wins; otherwise re-assert the admin value so a
  // late-loading admin config is never shadowed by a stale attribute.
  root.dataset.density = preferences.density ?? getCurrentAppearance().gridDensity;

  installAppearanceGuard();
}

export function savePreferences(preferences: UserPreferences): UserPreferences {
  const next = validatePreferences(preferences);
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Preferences still apply for the current page if storage is unavailable.
  }
  applyPreferences(next);
  window.dispatchEvent(new CustomEvent<UserPreferences>(PREFERENCES_EVENT, { detail: next }));
  return next;
}

export function updatePreferences(patch: Partial<UserPreferences>): UserPreferences {
  return savePreferences({ ...currentPreferences, ...patch });
}

export function subscribeToPreferences(
  callback: (preferences: UserPreferences) => void,
): () => void {
  const listener = (event: Event) => {
    callback((event as CustomEvent<UserPreferences>).detail);
  };
  window.addEventListener(PREFERENCES_EVENT, listener);
  return () => window.removeEventListener(PREFERENCES_EVENT, listener);
}

/**
 * The admin appearance loader applies its gridDensity to data-density when
 * it resolves (after first paint). If the user made an explicit density
 * choice on this device, re-assert it so the admin load can't clobber it.
 */
function installAppearanceGuard(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener(APPEARANCE_EVENT, () => {
    if (currentPreferences.density) {
      document.documentElement.dataset.density = currentPreferences.density;
    }
  });
}
