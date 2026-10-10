---
name: verify-site
description: Build the site, start the production server and check pages and the API actually work. Use after any UI, content or backend change, before saying it is done.
---

# Verify the site

1. `npm run storyblok:test && npm run build` (stop on failure and report the error).
2. Start the server in the background: `DATA_DIR=./.tmp-data PORT=4400 HOST=127.0.0.1 ADMIN_TOKEN=test node dist/server/entry.mjs`.
3. Check status 200 for `/`, `/tools/`, each `/tools/<slug>/`, `/author/`, `/audit/`, `/case-studies/`, and `/api/health/`.
4. API: POST `/api/analyze/` with `{"tool":"audit","url":"example.com"}` expects `ok:true`; `{"url":"127.0.0.1"}` and `localhost` must be refused (SSRF guard); `/api/submissions/` without a token must return 401.
5. For UI changes, screenshot with Playwright (`playwright-core` is in `C:\Users\ShubhamWalwadkar\projects\bni-report\node_modules`, Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`; run the script from inside this repo) and check the console for errors. Scroll slowly before full-page shots so reveal animations fire.
6. Stop the server and delete `.tmp-*` files and `./.tmp-data`.
