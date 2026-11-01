---
name: ui-test
source: https://github.com/browserbase/skills
---

# UI test workflow

Use this skill for adversarial UI QA with a real browser: keyboard flows, invalid input, accessibility checks, console errors, broken images, and responsive behavior.

Install with:

`npx skills add browserbase/skills --skill ui-test`

For this repository, prefer the checked-in Playwright suite under `tests/` for deterministic regression coverage. Use the external skill for exploratory/adversarial testing when a running app is available.
