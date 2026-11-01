---
name: strix-security
source: https://github.com/usestrix/strix
---

# Strix security workflow

Use the official Strix agent workflow for authorized security testing of this repository or its staging deployment.

## Install

`npx skills add usestrix/strix`

## Local scan prerequisites

- Docker running
- Strix CLI installed
- LLM provider configured with `STRIX_LLM` and `LLM_API_KEY`

## Safe project workflow

1. Run the scan only against a repository or deployment the project owner has authorized.
2. Prefer headless mode for automation: `strix -n -t ./ --scan-mode standard --max-budget 10`.
3. For a staging site, use its explicit URL rather than production by default.
4. Never commit API keys or scan secrets.
5. Review and remediate validated findings, then re-run the scan.
