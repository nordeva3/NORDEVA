/**
 * Shared model for the Custom Website Projects marketplace (requests board).
 *
 * Packages, lifecycle labels and small pure helpers used by the requests
 * page. Prices below are the specification's starting ranges — the final
 * price is always agreed between the client and the selected developer.
 */

export type PackageType = "simple" | "advanced" | "max_advanced";

export type ProjectPackage = {
  id: PackageType;
  label: string;
  min: number;
  max: number;
  blurb: string;
  suitableFor: string[];
};

export const PROJECT_PACKAGES: ProjectPackage[] = [
  {
    id: "simple",
    label: "Simple Website",
    min: 50,
    max: 100,
    blurb: "A clean, basic website that gets you online fast.",
    suitableFor: [
      "Basic business websites",
      "Personal websites",
      "Simple landing pages",
      "Portfolio websites",
      "Basic informational websites",
    ],
  },
  {
    id: "advanced",
    label: "Advanced Website",
    min: 100,
    max: 200,
    blurb: "More pages, richer design and extra functionality.",
    suitableFor: [
      "E-commerce websites",
      "Login & accounts",
      "Admin dashboards",
      "Database-powered sites",
    ],
  },
  {
    id: "max_advanced",
    label: "Max Advanced Website",
    min: 200,
    max: 1000,
    blurb: "Fully custom builds with advanced features and integrations.",
    suitableFor: ["SaaS applications", "Marketplaces", "Multi-user platforms", "Advanced web apps"],
  },
];

export function packageMeta(id: string | null | undefined): ProjectPackage | null {
  return PROJECT_PACKAGES.find((p) => p.id === id) ?? null;
}

/** Legacy pre-upgrade tiers (kept so old rows still render sensibly). */
export const LEGACY_TIERS: Record<string, { label: string; packageEquivalent: PackageType }> = {
  normal: { label: "Normal website", packageEquivalent: "simple" },
  advanced: { label: "Advanced website", packageEquivalent: "advanced" },
  high_end: { label: "High-end advanced", packageEquivalent: "max_advanced" },
};

/** The project lifecycle states, with display metadata. */
export const PROJECT_STATUSES: Record<string, { label: string; classes: string }> = {
  draft: { label: "Draft", classes: "bg-muted text-muted-foreground" },
  pending_review: { label: "Pending review", classes: "bg-amber-500/15 text-amber-400" },
  open: { label: "Open", classes: "bg-emerald-500/15 text-emerald-400" },
  proposals_received: { label: "Proposals received", classes: "bg-sky-500/15 text-sky-400" },
  developer_selected: { label: "Developer selected", classes: "bg-violet-500/15 text-violet-400" },
  awaiting_agreement: { label: "Awaiting agreement", classes: "bg-amber-500/15 text-amber-400" },
  awaiting_payment: { label: "Awaiting payment", classes: "bg-amber-500/15 text-amber-400" },
  in_progress: { label: "In progress", classes: "bg-sky-500/15 text-sky-400" },
  preview_submitted: { label: "Preview submitted", classes: "bg-teal-500/15 text-teal-400" },
  revision_requested: { label: "Revision requested", classes: "bg-orange-500/15 text-orange-400" },
  resubmitted: { label: "Resubmitted", classes: "bg-teal-500/15 text-teal-400" },
  final_submitted: { label: "Final submitted", classes: "bg-teal-500/15 text-teal-400" },
  completed: { label: "Completed", classes: "bg-muted text-muted-foreground" },
  payment_released: { label: "Payment released", classes: "bg-emerald-500/15 text-emerald-400" },
  cancelled: { label: "Cancelled", classes: "bg-red-500/15 text-red-400" },
  disputed: { label: "Disputed", classes: "bg-red-500/15 text-red-400" },
  refunded: { label: "Refunded", classes: "bg-muted text-muted-foreground" },
};

/** Minimal shape shared by the public view and the owner table rows. */
export type RequestLike = {
  id: string;
  requester_id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  status: string;
  taken_by: string | null;
  created_at: string;
  tier?: string | null;
  photos?: string[] | null;
  package_type?: string | null;
  project_status?: string | null;
  category?: string | null;
  purpose?: string | null;
  target_audience?: string | null;
  required_pages?: string | null;
  required_functionality?: string | null;
  preferred_technologies?: string[] | null;
  design_references?: string | null;
  reference_urls?: string[] | null;
  domain_needs?: string | null;
  hosting_needs?: string | null;
  deadline?: string | null;
  is_draft?: boolean | null;
  agreed_amount?: number | null;
  agreed_currency?: string | null;
  selected_proposal_id?: string | null;
};

/**
 * Effective lifecycle state: the new project_status when set, otherwise a
 * sensible derivation from the legacy status used before the upgrade.
 * (Legacy "taken" rows read as developer-assigned; the assigned developer is
 * surfaced separately on the card.)
 */
export function effectiveStatus(r: RequestLike): string {
  if (r.project_status) return r.project_status;
  switch (r.status) {
    case "open":
      return "open";
    case "taken":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "open";
  }
}

/** Package used for badges/filters: the stored package, else the legacy tier's equivalent. */
export function effectivePackage(r: RequestLike): PackageType | null {
  if (r.package_type && packageMeta(r.package_type)) return r.package_type as PackageType;
  if (r.tier && LEGACY_TIERS[r.tier]) return LEGACY_TIERS[r.tier].packageEquivalent;
  return null;
}

/** Badge text for a request's package/tier. */
export function packageBadgeLabel(r: RequestLike): string | null {
  if (r.package_type) return packageMeta(r.package_type)?.label ?? null;
  if (r.tier && LEGACY_TIERS[r.tier]) return LEGACY_TIERS[r.tier].label;
  return null;
}

export const REQUEST_CATEGORIES = [
  "Business website",
  "Portfolio",
  "E-commerce",
  "Landing page",
  "Blog / magazine",
  "SaaS / web app",
  "Restaurant / local business",
  "Other",
] as const;

export const TECHNOLOGY_SUGGESTIONS = [
  "WordPress",
  "React",
  "Next.js",
  "Vue",
  "HTML/CSS",
  "PHP",
  "Laravel",
  "Node.js",
  "Shopify",
  "Webflow",
  "Tailwind CSS",
  "PostgreSQL",
];

export const FORM_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AED",
  "PKR",
  "BDT",
  "AUD",
  "CAD",
  "SGD",
] as const;
