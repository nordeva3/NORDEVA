export const PRODUCT_TYPES = [
  { value: "software", label: "Software / App" },
  { value: "website", label: "Website / Template" },
  { value: "wordpress", label: "WordPress" },
  { value: "graphics", label: "Graphics / Design" },
  { value: "audio", label: "Audio / Music" },
  { value: "video", label: "Video" },
  { value: "ebook", label: "eBook / Document" },
  { value: "course", label: "Course / Education" },
  { value: "other", label: "Other digital product" },
] as const;

export const PRODUCT_CATEGORIES = [
  "AI & Automation",
  "Apps & Software",
  "Websites & Templates",
  "WordPress",
  "UI/UX & Design",
  "Graphics",
  "3D & Game Assets",
  "Audio & Music",
  "Video & Motion",
  "eBooks & Documents",
  "Courses & Education",
  "Developer Tools",
  "Marketing",
  "Business",
  "Other",
];

export const TAG_SUGGESTIONS = [
  "ai",
  "automation",
  "api",
  "app",
  "android",
  "analytics",
  "admin",
  "dashboard",
  "ecommerce",
  "figma",
  "frontend",
  "backend",
  "javascript",
  "typescript",
  "react",
  "nextjs",
  "nodejs",
  "tailwind",
  "saas",
  "startup",
  "business",
  "marketing",
  "seo",
  "wordpress",
  "woocommerce",
  "ui",
  "ux",
  "design",
  "template",
  "website",
  "landing-page",
  "mobile",
  "ios",
  "chrome",
  "python",
  "php",
  "laravel",
  "supabase",
  "firebase",
  "stripe",
  "shopify",
  "education",
  "course",
  "ebook",
  "graphics",
  "3d",
  "game-assets",
  "audio",
  "video",
  "motion",
  "productivity",
];

export const PLATFORMS = [
  "Web",
  "Windows",
  "macOS",
  "Linux",
  "Android",
  "iOS",
  "Chrome",
  "Figma",
  "WordPress",
];
export const LICENSE_TYPES = [
  { value: "standard", label: "Standard / Personal" },
  { value: "commercial", label: "Commercial" },
  { value: "extended", label: "Extended Commercial" },
  { value: "agency", label: "Agency / Multi-seat" },
  { value: "custom", label: "Custom license" },
];
export const PRICING_MODELS = [
  { value: "one_time", label: "One-time purchase" },
  { value: "subscription", label: "Subscription" },
  { value: "free", label: "Free" },
  { value: "pay_what_you_want", label: "Pay what you want" },
];

export function scoreProductStudio(input: {
  title: string;
  description: string;
  category: string;
  cover: boolean;
  screenshots: number;
  demo: string;
  docs: string;
  requirements: string;
  tags: string[];
  features: string[];
  files: number;
  variantCount: number;
  rights: boolean;
  assets: boolean;
  legal: boolean;
  seoTitle: string;
  seoDescription: string;
}) {
  let score = 0;
  const checks = [
    [Boolean(input.title.trim()), 10],
    [input.description.trim().length >= 120, 10],
    [Boolean(input.category), 5],
    [input.cover, 10],
    [input.screenshots >= 3, 8],
    [Boolean(input.demo.trim()), 6],
    [Boolean(input.docs.trim()), 6],
    [Boolean(input.requirements.trim()), 5],
    [input.tags.length >= 3, 5],
    [input.features.length >= 3, 5],
    [input.files >= 1, 10],
    [input.variantCount >= 1, 4],
    [input.rights, 5],
    [input.assets, 3],
    [input.legal, 3],
    [Boolean(input.seoTitle.trim()), 3],
    [Boolean(input.seoDescription.trim()), 3],
  ] as const;
  for (const [ok, points] of checks) if (ok) score += points;
  return Math.min(100, score);
}

export function splitLines(value: string) {
  return value
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);
}
