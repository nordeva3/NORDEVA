# VELORA Browser & Security QA Setup

## Playwright

This project is wired for the official Playwright CLI and Playwright Test.

- `npm install`
- `npx playwright install chromium`
- `npm run test:e2e`
- `npm run test:e2e:ui`
- `npm run playwright:cli`

The CLI package is `@playwright/cli` and the test runner is `@playwright/test`.

## Strix

Strix is an external security tool/agent skill, not a normal application runtime dependency. Install its official skills when the security environment is available:

`npx skills add usestrix/strix`

Then configure a non-production/staging target and the required LLM credentials outside the repository.

## UI testing skill

A UI-test agent skill is documented under `.agents/skills/ui-test/` and can be installed with:

`npx skills add browserbase/skills --skill ui-test`

No secrets, browser profiles, or generated test artifacts are committed to the repository.

## VELORA AI provider

VELORA AI uses the server-only Google Gemini API. Configure `GEMINI_API_KEY` and optionally `GEMINI_MODEL=gemini-3.8-flash`. Never expose the key through a `VITE_*` variable.
