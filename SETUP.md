# Setup: GitHub, Storyblok, hosting, Claude Code

Do these in order. Each step says how to know it worked.

## 1. GitHub
1. Push the branch: `git push -u origin site-rebuild`, then open a pull request into `main` and merge it.
2. Repo -> Settings -> Secrets and variables -> Actions -> add:
   - `STORYBLOK_MANAGEMENT_TOKEN` (Storyblok: My Account -> Personal Access Tokens)
   - `STORYBLOK_SPACE_ID` (Space Settings -> General, digits only)
   - `STORYBLOK_REGION` only if your space is not EU (`us`, `ca`, `ap`, `cn`)
3. Create a GitHub token for the site server: Settings -> Developer settings -> Fine-grained tokens, this repo only, permission **Contents: Read and write**. You will paste it into the host in step 3.
Works when: the "Sync content to Storyblok" run (Actions tab) goes green after the merge.

## 2. Storyblok
1. After the first green sync, the space contains components and stories for services, industries, case studies, pillars, authors and tools.
2. Settings -> Webhooks -> New webhook:
   - URL: `https://<your-domain>/api/storyblok-webhook/` (trailing slash)
   - Events: story published, unpublished, deleted
   - Secret: any long random string (reuse it in step 3)
Works when: you edit a meta description in Storyblok, publish, and a "Pull content from Storyblok" run appears in GitHub Actions and commits to `main`.

## 3. Host the site
Any container host works; `render.yaml` is a ready Render blueprint (persistent disk included).
1. Render -> New -> Blueprint -> pick this repo.
2. Set environment variables (see `.env.example`):
   - `ADMIN_TOKEN` (long random string; opens `/admin/`)
   - `WEBHOOK_URL` (Slack/Discord/Zapier URL for instant lead alerts) and/or `RESEND_API_KEY` + `NOTIFY_EMAIL`
   - `STORYBLOK_WEBHOOK_SECRET` (same as step 2)
   - `GITHUB_TOKEN` (step 1.3) and `GITHUB_REPO` (`thelordwalwadkar/funneling-revenue-storyblock-automation`)
3. Point your domain at it. Update `site` in `astro.config.mjs` if the domain differs from `funnelingrevenue.com`.
Works when: `/api/health/` returns `{"ok":true}`, a tool run on the site appears in `/admin/`.

### Hostinger (current live host)
The live site runs as a Hostinger Node.js web app.
1. hPanel -> Websites -> the site -> Node.js app -> connect GitHub repo `thelordwalwadkar/funneling-revenue-storyblock-automation`, branch `main`.
2. Build command `npm run build`, start command `npm start`, Node 22. Set the step 3.2 environment variables there.
3. Turn on automatic deployment, so every push to `main` redeploys.
Works when: a merged pull request shows up on the live site within a few minutes.

`.github/workflows/build-check.yml` builds every pull request first, so a red cross means "don't merge".

## 4. Change everything through Claude Code
1. Open this folder in VS Code (or `claude` in a terminal here).
2. `CLAUDE.md` holds the rules; skills are `/add-case-study`, `/storyblok-sync`, `/verify-site`.
3. Typical requests: "add a case study for X with these numbers", "rewrite the meta descriptions for all services", "add a fifth tool that does Y", "check the site works".
4. Claude Code is blocked from `git push` and Storyblok pushes by `.claude/settings.json`, so you approve those. Remove the matching `deny` lines if you want it fully hands-off.

## Day to day
- Content/meta edits: Storyblok UI -> publish -> site updates itself (steps 2-3).
- Anything structural (layout, tools, backend): ask Claude Code, review the diff, push.
- Leads and tool runs: `/admin/`, plus your webhook/email.
