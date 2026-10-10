---
name: storyblok-sync
description: Push or pull content between src/content and Storyblok, or debug the sync. Use for any Storyblok, webhook or content-automation task.
---

# Storyblok sync

- Offline check first, always: `npm run storyblok:test` (every Markdown entry must round-trip).
- Push repo to Storyblok: `npm run storyblok:sync`. Pull Storyblok to repo: `npm run storyblok:pull`. Both need `STORYBLOK_MANAGEMENT_TOKEN` and `STORYBLOK_SPACE_ID` (and `STORYBLOK_REGION` if not EU) in `.env`. Pushing publishes stories live, so confirm with the user before running it.
- Field mapping lives in one place: `scripts/storyblok/mappers.mjs` (spec drives both directions). Component schemas are in `scripts/storyblok/components.mjs`. A new field needs all three: `content.config.ts`, `mappers.mjs`, `components.mjs`.
- Automation chain: Storyblok publish -> `POST /api/storyblok-webhook/` (HMAC-SHA1 with `STORYBLOK_WEBHOOK_SECRET`) -> GitHub `repository_dispatch` -> `.github/workflows/storyblok-pull.yml` -> commit -> host redeploys.
- If the chain is silent, check in order: webhook secret matches, `GITHUB_TOKEN` + `GITHUB_REPO` set on the server, the 30 s debounce, workflow run log.
