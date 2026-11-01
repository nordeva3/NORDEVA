# VELORA UI refresh — October 2026

## Design direction

- Warm editorial neutrals with a restrained violet accent, replacing the default cosmic/glow-heavy styling.
- Sora headings and Inter interface/body typography retained from the existing product.
- Reduced visual effects, quieter borders and shadows, and a visible reduced-motion preference fallback.
- Homepage copy updated to focus on useful digital work and USD pricing.
- Light appearance is now the first-visit default; theme choice is stored under `velora-theme`.

## Editable Figma reference

https://www.figma.com/design/Jb5IvPJSqChjknwnyHoNdn

The Figma homepage is an editable reference composition with 192 descendant layers (122 frames, 69 text nodes, and 1 polygon), four hand-built product preview cards, and eight main sections. It is a design reference, not a live implementation or test result.

## QA performed

- TypeScript/TSX transpile syntax scan: 110 files, 0 syntax errors.
- `node scripts.production-audit.mjs`: 48 PASS, 0 FAIL.
- Production build, ESLint, browser tests, payment flow, and remote Supabase migrations were not run in this environment because project dependencies and service credentials were not installed/configured.
