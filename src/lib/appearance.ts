// NORDEVA appearance system — site-wide visual configuration.
//
// The canonical copy lives in the `platform_settings` table under the key
// "appearance" and is read/written exclusively through the server functions
// in `appearance.functions.ts` (the table is service-role only). This module
// is shared and side-effect free apart from explicit DOM/localStorage calls:
// types, preset catalogue, validation (clamping) and application helpers.

export const APPEARANCE_PRESETS = [
  {
    id: "titanium",
    label: "Titanium",
    blurb: "Graphite and silver — premium minimalism, precise and monochrome.",
    swatches: ["#0B0D10", "#F5F6F8", "#AEB9C8"],
  },
  {
    id: "premium-dark",
    label: "Premium Dark",
    blurb: "The signature NORDEVA look — teal accent on deep ink surfaces.",
    swatches: ["#101a21", "#1b2833", "#4fc4b5"],
  },
  {
    id: "classic-marketplace",
    label: "Classic Marketplace",
    blurb: "Marketplace clarity — bright neutral surfaces, confident blue accent.",
    swatches: ["#f6f8fb", "#ffffff", "#2f6bd8"],
  },
  {
    id: "modern-minimal",
    label: "Modern Minimal",
    blurb: "Near-monochrome surfaces, tight corners, a single indigo accent.",
    swatches: ["#f4f4f5", "#ffffff", "#6558e8"],
  },
  {
    id: "editorial-commerce",
    label: "Editorial Commerce",
    blurb: "Warm paper tones, serif display type, clay accent.",
    swatches: ["#f4ecdc", "#fdfaf2", "#b0512c"],
  },
  {
    id: "professional-neutral",
    label: "Professional Neutral",
    blurb: "Conservative grey-neutral surfaces with a blue-grey accent.",
    swatches: ["#f3f4f5", "#ffffff", "#5b7186"],
  },
] as const;

export type AppearancePreset = (typeof APPEARANCE_PRESETS)[number]["id"];
export type CardVariant = "standard" | "compact" | "featured" | "horizontal" | "editorial";
export type GridDensity = "comfortable" | "compact";
export type ContentWidth = "standard" | "wide";
export type PromoBannerBackground = "accent" | "image";

export interface PromoBannerConfig {
  enabled: boolean;
  label: string;
  heading: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  bg: PromoBannerBackground;
  imageUrl: string;
}

export interface AppearanceConfig {
  preset: AppearancePreset;
  cardVariant: CardVariant;
  gridDensity: GridDensity;
  contentWidth: ContentWidth;
  /** Optional hue rotation (0–360) applied to the preset accent; null = preset accent. */
  accentHue: number | null;
  promoBanner: PromoBannerConfig;
}

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  preset: "titanium",
  cardVariant: "standard",
  gridDensity: "comfortable",
  contentWidth: "standard",
  accentHue: null,
  promoBanner: {
    enabled: false,
    label: "",
    heading: "",
    description: "",
    ctaLabel: "",
    ctaHref: "",
    bg: "accent",
    imageUrl: "",
  },
};

const PRESET_IDS: readonly string[] = APPEARANCE_PRESETS.map((p) => p.id);
const CARD_VARIANTS: readonly string[] = [
  "standard",
  "compact",
  "featured",
  "horizontal",
  "editorial",
];
const GRID_DENSITIES: readonly string[] = ["comfortable", "compact"];
const CONTENT_WIDTHS: readonly string[] = ["standard", "wide"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isSafeHref(value: string): boolean {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isSafeImageUrl(value: string): boolean {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Human-readable problems with a candidate appearance payload. Used on the
 * save path (admin design settings) so invalid values are rejected with a
 * message instead of being silently clamped.
 */
export function appearanceIssues(input: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(input)) return ["Appearance settings must be an object"];
  if (input.preset !== undefined && !PRESET_IDS.includes(String(input.preset))) {
    issues.push(`Unknown appearance preset "${String(input.preset)}"`);
  }
  if (input.cardVariant !== undefined && !CARD_VARIANTS.includes(String(input.cardVariant))) {
    issues.push(`Unknown card variant "${String(input.cardVariant)}"`);
  }
  if (input.gridDensity !== undefined && !GRID_DENSITIES.includes(String(input.gridDensity))) {
    issues.push(`Unknown grid density "${String(input.gridDensity)}"`);
  }
  if (input.contentWidth !== undefined && !CONTENT_WIDTHS.includes(String(input.contentWidth))) {
    issues.push(`Unknown content width "${String(input.contentWidth)}"`);
  }
  if (input.accentHue !== undefined && input.accentHue !== null) {
    const hue = Number(input.accentHue);
    if (!Number.isFinite(hue)) issues.push("Accent hue must be a number");
    else if (hue < 0 || hue > 360) issues.push("Accent hue must be between 0 and 360");
  }
  if (input.promoBanner !== undefined) {
    if (!isRecord(input.promoBanner)) {
      issues.push("Promo banner settings must be an object");
    } else {
      const banner = input.promoBanner;
      if (banner.bg !== undefined && banner.bg !== "accent" && banner.bg !== "image") {
        issues.push(`Unknown promo banner background "${String(banner.bg)}"`);
      }
      if (typeof banner.heading === "string" && banner.heading.length > 140) {
        issues.push("Promo banner heading is too long (max 140 characters)");
      }
      if (typeof banner.description === "string" && banner.description.length > 320) {
        issues.push("Promo banner description is too long (max 320 characters)");
      }
      if (typeof banner.ctaHref === "string" && !isSafeHref(banner.ctaHref.trim())) {
        issues.push("Promo banner CTA link must be a site path or an http(s) URL");
      }
      if (typeof banner.imageUrl === "string" && !isSafeImageUrl(banner.imageUrl.trim())) {
        issues.push("Promo banner image must be a site path or an http(s) URL");
      }
    }
  }
  return issues;
}

/**
 * Clamp any untrusted payload into a valid AppearanceConfig. Never throws:
 * unknown enums fall back to defaults, strings are trimmed and length-capped,
 * unsafe URLs are dropped, and the accent hue is wrapped into 0–360.
 */
export function validateAppearance(input: unknown): AppearanceConfig {
  if (!isRecord(input)) return DEFAULT_APPEARANCE;
  const banner = isRecord(input.promoBanner) ? input.promoBanner : {};
  const rawHue = input.accentHue;
  const hue =
    rawHue === null || rawHue === undefined || !Number.isFinite(Number(rawHue))
      ? null
      : ((Number(rawHue) % 360) + 360) % 360;
  const ctaHref = clampText(banner.ctaHref, 300);
  const imageUrl = clampText(banner.imageUrl, 500);
  return {
    preset: PRESET_IDS.includes(String(input.preset))
      ? (input.preset as AppearancePreset)
      : DEFAULT_APPEARANCE.preset,
    cardVariant: CARD_VARIANTS.includes(String(input.cardVariant))
      ? (input.cardVariant as CardVariant)
      : DEFAULT_APPEARANCE.cardVariant,
    gridDensity: GRID_DENSITIES.includes(String(input.gridDensity))
      ? (input.gridDensity as GridDensity)
      : DEFAULT_APPEARANCE.gridDensity,
    contentWidth: CONTENT_WIDTHS.includes(String(input.contentWidth))
      ? (input.contentWidth as ContentWidth)
      : DEFAULT_APPEARANCE.contentWidth,
    accentHue: hue,
    promoBanner: {
      enabled: banner.enabled === true,
      label: clampText(banner.label, 60),
      heading: clampText(banner.heading, 140),
      description: clampText(banner.description, 320),
      ctaLabel: clampText(banner.ctaLabel, 60),
      ctaHref: isSafeHref(ctaHref) ? ctaHref : "",
      bg: banner.bg === "image" ? "image" : "accent",
      imageUrl: isSafeImageUrl(imageUrl) ? imageUrl : "",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Application + cache (browser only)                                  */
/* ------------------------------------------------------------------ */

export const APPEARANCE_KEY = "velora-appearance";
export const APPEARANCE_EVENT = "velora-appearance-change";

let currentAppearance: AppearanceConfig = DEFAULT_APPEARANCE;

export function getCurrentAppearance(): AppearanceConfig {
  return currentAppearance;
}

/**
 * Apply a config to the document: preset/density/width data attributes and
 * the optional accent-hue override variable consumed by styles.css. Does not
 * touch the local cache — callers decide what is canonical (see
 * loadAppearance / the admin design panel).
 */
export function applyAppearance(config: AppearanceConfig): void {
  currentAppearance = config;
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.preset = config.preset;
  root.dataset.density = config.gridDensity;
  root.dataset.width = config.contentWidth;
  // TITANIUM is a strict monochrome identity: the accent-hue override is
  // never applied under it (styles.css also scopes the hue blocks out), so
  // the silver accent cannot be rotated into a colour.
  if (config.accentHue !== null && config.preset !== "titanium") {
    root.dataset.accentHue = "true";
    root.style.setProperty("--accent-hue", String(config.accentHue));
  } else {
    delete root.dataset.accentHue;
    root.style.removeProperty("--accent-hue");
  }
  window.dispatchEvent(new CustomEvent<AppearanceConfig>(APPEARANCE_EVENT, { detail: config }));
}

export function cacheAppearance(config: AppearanceConfig): void {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(config));
  } catch {
    // Cache is a paint optimisation only; the server copy stays canonical.
  }
}

export function readCachedAppearance(): AppearanceConfig | null {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_KEY);
    return raw ? validateAppearance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Load the canonical appearance: the cached copy paints first (the root
 * bootstrap script applies it before hydration), then the server copy is
 * fetched, cached and applied. Falls back to cache/defaults if the server
 * is unreachable.
 */
export async function loadAppearance(): Promise<AppearanceConfig> {
  let config = readCachedAppearance() ?? DEFAULT_APPEARANCE;
  try {
    const { getAppearance } = await import("./appearance.functions");
    config = validateAppearance(await getAppearance());
  } catch {
    // Keep cached/default appearance when the server copy cannot be read.
  }
  cacheAppearance(config);
  applyAppearance(config);
  return config;
}

export function subscribeToAppearance(callback: (config: AppearanceConfig) => void): () => void {
  const listener = (event: Event) => {
    callback((event as CustomEvent<AppearanceConfig>).detail);
  };
  window.addEventListener(APPEARANCE_EVENT, listener);
  return () => window.removeEventListener(APPEARANCE_EVENT, listener);
}
