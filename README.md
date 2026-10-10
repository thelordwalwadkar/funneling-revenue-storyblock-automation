# Funnelling Revenue

Revenue-first marketing website for manufacturers and industrial brands, built in [Astro](https://astro.build). Static pages plus a small Node backend in one deployable container.

**What is on the site:** interactive homepage (animated funnel, stage explorer, live funnel calculator), services, industries, case studies (before / what we did / after explorer), insights, an author page, a free-tools section, and a free-audit lead form.

## Free tools and backend

| Tool | URL | What it does |
| :--- | :--- | :--- |
| Website Revenue Audit | `/tools/website-revenue-audit/` | 18 checks, 0-100 score, ToFu/MoFu/BoFu coverage, top fixes |
| AI Visibility Checker | `/tools/ai-visibility-checker/` | AI-crawler access (robots.txt), llms.txt, entity schema, citable structure |
| SERP & Meta Previewer | `/tools/serp-meta-previewer/` | Google and social previews, length checks, rewrite hints |
| Funnel Revenue Calculator | `/tools/funnel-revenue-calculator/` | Client-side, nothing sent anywhere |

Any tool URL accepts `?url=example.com` and runs immediately, handy for outreach links.

When someone runs a tool or submits the audit form, the backend (`src/pages/api/`, `src/lib/server/`) automatically:

1. fetches and analyses the URL (SSRF-hardened: no private/loopback/metadata addresses, DNS checked at connect time, redirects re-validated, size and time capped, rate limited);
2. stores the result in `DATA_DIR/submissions.jsonl`;
3. for leads, audits their website, scores the lead as hot / warm / cold and writes the recommended next step;
4. pushes a summary to `WEBHOOK_URL` (Slack, Discord, Zapier...) and/or email (`RESEND_API_KEY` + `NOTIFY_EMAIL`).

Review everything at `/admin/` (needs `ADMIN_TOKEN`) or `GET /api/submissions/` with `Authorization: Bearer <ADMIN_TOKEN>` (`?format=csv` for a spreadsheet). API routes need the trailing slash.

## Deploy

```
docker build -t funnelling-revenue .
docker run -p 4321:4321 -v funnelling-data:/data --env-file .env funnelling-revenue
```

`render.yaml` is a ready Render blueprint (persistent disk included). Any container host works. Health check: `/api/health/`. Without Docker: `npm ci && npm run build && npm start`.

## Content automation (Storyblok)

Two directions, both automatic once configured:

- **Repo -> Storyblok:** `.github/workflows/storyblok-sync.yml` pushes component schemas and stories on every change under `src/content/`.
- **Storyblok -> site:** edit titles, meta or copy in Storyblok and publish. Storyblok calls `POST /api/storyblok-webhook/` (signature verified with `STORYBLOK_WEBHOOK_SECRET`), which triggers `.github/workflows/storyblok-pull.yml`. That pulls the stories back into `src/content/*.md`, checks the build, commits, and your host redeploys. Set `GITHUB_TOKEN` + `GITHUB_REPO` (or `DEPLOY_HOOK_URL`) on the server.

Setup in Storyblok: Settings -> Webhooks -> add `https://<your-domain>/api/storyblok-webhook/` for story published / unpublished / deleted, with the same secret.

Manual runs: `npm run storyblok:sync` (push) and `npm run storyblok:pull` (pull); both need `STORYBLOK_MANAGEMENT_TOKEN` and `STORYBLOK_SPACE_ID`.

`npm run storyblok:test` proves offline that every Markdown entry round-trips through the Storyblok mapping unchanged.

## Commands

| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the local dev server (`astro dev --background` to run it detached — see `astro dev status` / `stop` / `logs`) |
| `npm run build` | Build the static site to `./dist/` |
| `npm run preview` | Preview the production build locally |
| `npm start` | Run the production server (static pages + API) |

## SEO / GEO

Per-page JSON-LD, canonical URLs, OpenGraph/Twitter tags, `sitemap-index.xml` (via `@astrojs/sitemap`), `robots.txt`, and an `llms.txt` at the site root for AI-crawler retrieval.
