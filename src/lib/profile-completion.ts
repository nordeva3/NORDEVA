/**
 * Profile completion scoring (master spec, Part 8).
 *
 * Pure functions over real profile data — no hardcoded percentages, no
 * placeholder text counts as content. The result is OWNER-ONLY information:
 * it must never be rendered on public profiles, and reaching 100% is a
 * profile-strength milestone only — it is NOT identity verification.
 */

export type ProfileCompletionInput = {
  avatarUrl?: string | null;
  displayName?: string | null;
  username?: string | null;
  headline?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  languages?: string[] | null;
  experienceLevel?: string | null;
  yearsExperience?: number | null;
  availability?: string | null;
  githubUrl?: string | null;
  twitterUrl?: string | null;
  websiteUrl?: string | null;
  email?: string | null;
  /** Number of saved portfolio items (profile_portfolio rows). */
  portfolioCount: number;
  /** Number of listings owned by the user (any status). */
  listingCount: number;
};

export type CompletionItem = {
  key: string;
  label: string;
  weight: number;
  complete: boolean;
  /** Short improvement suggestion shown while the item is incomplete. */
  hint: string;
  /** DOM id of the matching section in the dashboard profile editor. */
  anchor: string;
};

export type CompletionMilestone = {
  threshold: number;
  label: string;
};

export type ProfileCompletion = {
  variant: "developer" | "client";
  percent: number;
  items: CompletionItem[];
  /** Highest milestone reached at the current percent, or null below 25%. */
  milestone: CompletionMilestone | null;
  /** First incomplete item — the most useful next improvement. */
  nextItem: CompletionItem | null;
};

export const COMPLETION_MILESTONES: CompletionMilestone[] = [
  { threshold: 25, label: "Getting Started" },
  { threshold: 50, label: "Building Your Profile" },
  { threshold: 75, label: "Almost Complete" },
  { threshold: 100, label: "Profile Complete" },
];

const PLACEHOLDER_WORDS = new Set([
  "n/a",
  "na",
  "none",
  "-",
  "--",
  "todo",
  "tbd",
  "test",
  "user",
  "velora user",
  "nordeva user",
  "no bio",
  "no headline",
]);

/** A string counts only when it holds real content, not a placeholder. */
function meaningful(value: string | null | undefined, minLength = 1): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length < minLength) return false;
  return !PLACEHOLDER_WORDS.has(v.toLowerCase());
}

function realTags(values: string[] | null | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = (raw ?? "").trim();
    if (v && !PLACEHOLDER_WORDS.has(v.toLowerCase())) seen.add(v.toLowerCase());
  }
  return [...seen];
}

function finish(variant: "developer" | "client", items: CompletionItem[]): ProfileCompletion {
  const percent = items.reduce((sum, i) => sum + (i.complete ? i.weight : 0), 0);
  let milestone: CompletionMilestone | null = null;
  for (const m of COMPLETION_MILESTONES) if (percent >= m.threshold) milestone = m;
  return {
    variant,
    percent,
    items,
    milestone,
    nextItem: items.find((i) => !i.complete) ?? null,
  };
}

/**
 * Variant rule (decided here, per spec Part 8.2): a user is scored with the
 * DEVELOPER checklist when they show any developer signal — at least one
 * listing, at least one portfolio item, or at least one real skill.
 * Everyone else is scored with the CLIENT checklist, which drops
 * portfolio/skills/experience requirements. The decision is recomputed from
 * live data on every call, so a client who adds a first skill or listing
 * automatically moves to the developer checklist.
 */
export function computeProfileCompletion(input: ProfileCompletionInput): ProfileCompletion {
  const skills = realTags(input.skills);
  const languages = realTags(input.languages);
  const isDeveloper = input.listingCount > 0 || input.portfolioCount > 0 || skills.length > 0;

  const hasPhoto = meaningful(input.avatarUrl);
  const hasNameAndUsername = meaningful(input.displayName) && meaningful(input.username);
  // A biography counts only when it says something (10+ real characters).
  const hasBio = meaningful(input.bio, 10);
  const hasSocial =
    meaningful(input.githubUrl) || meaningful(input.twitterUrl) || meaningful(input.websiteUrl);

  if (!isDeveloper) {
    return finish("client", [
      {
        key: "photo",
        label: "Profile photo",
        weight: 15,
        complete: hasPhoto,
        hint: "Add your profile photo.",
        anchor: "pe-photo",
      },
      {
        key: "name",
        label: "Display name & username",
        weight: 15,
        complete: hasNameAndUsername,
        hint: "Set your display name and a unique username.",
        anchor: "pe-basics",
      },
      {
        key: "bio",
        label: "Biography",
        weight: 20,
        complete: hasBio,
        hint: "Write a short biography so developers know who they're working with.",
        anchor: "pe-bio",
      },
      {
        key: "website",
        label: "Company / website",
        weight: 15,
        complete: meaningful(input.websiteUrl),
        hint: "Add your company or business website.",
        anchor: "pe-links",
      },
      {
        key: "languages",
        label: "Languages",
        weight: 10,
        complete: languages.length >= 1,
        hint: "Add the languages you work in.",
        anchor: "pe-languages",
      },
      {
        key: "social",
        label: "Social or professional links",
        weight: 10,
        complete: hasSocial,
        hint: "Add at least one professional link (website, GitHub or X).",
        anchor: "pe-links",
      },
      {
        key: "email",
        label: "Contact email",
        weight: 15,
        complete: meaningful(input.email) && /.+@.+\..+/.test((input.email ?? "").trim()),
        hint: "Make sure your account has a contact email.",
        anchor: "pe-basics",
      },
    ]);
  }

  const hasExperience =
    meaningful(input.experienceLevel) ||
    (typeof input.yearsExperience === "number" && input.yearsExperience > 0);

  return finish("developer", [
    {
      key: "photo",
      label: "Profile photo",
      weight: 10,
      complete: hasPhoto,
      hint: "Add your profile photo.",
      anchor: "pe-photo",
    },
    {
      key: "name",
      label: "Display name & username",
      weight: 10,
      complete: hasNameAndUsername,
      hint: "Set your display name and a unique username.",
      anchor: "pe-basics",
    },
    {
      key: "headline",
      label: "Professional headline",
      weight: 10,
      complete: meaningful(input.headline, 3),
      hint: "Write a professional headline, e.g. “WordPress developer for small businesses”.",
      anchor: "pe-headline",
    },
    {
      key: "bio",
      label: "Biography",
      weight: 10,
      complete: hasBio,
      hint: "Write a professional biography.",
      anchor: "pe-bio",
    },
    {
      key: "skills",
      label: "Skills (3 or more)",
      weight: 15,
      complete: skills.length >= 3,
      hint: "Add your skills — at least three.",
      anchor: "pe-skills",
    },
    {
      key: "portfolio",
      label: "Portfolio (1 or more projects)",
      weight: 20,
      complete: input.portfolioCount >= 1,
      hint: "Upload portfolio projects to show your work.",
      anchor: "pe-portfolio",
    },
    {
      key: "experience",
      label: "Experience",
      weight: 10,
      complete: hasExperience,
      hint: "Add your experience level or years of experience.",
      anchor: "pe-experience",
    },
    {
      key: "languages",
      label: "Languages",
      weight: 5,
      complete: languages.length >= 1,
      hint: "Add the languages you work in.",
      anchor: "pe-languages",
    },
    {
      key: "social",
      label: "Social or professional links",
      weight: 5,
      complete: hasSocial,
      hint: "Add at least one professional link (website, GitHub or X).",
      anchor: "pe-links",
    },
    {
      key: "availability",
      label: "Availability",
      weight: 5,
      complete: meaningful(input.availability),
      hint: "Set your availability so clients know if you can take work.",
      anchor: "pe-availability",
    },
  ]);
}
