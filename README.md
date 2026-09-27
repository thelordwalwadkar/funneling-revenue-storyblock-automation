# Funnelling Revenue

Revenue-first marketing website for manufacturers and industrial brands, built in [Astro](https://astro.build). Homepage, The Funnel Thesis, Services, Industries, Case Studies, Insights, and a free-audit conversion page, driven by typed content collections.

## Project structure

```
src/
├── content/            # Services, industries, case studies, and pillar content (Markdown + frontmatter)
├── content.config.ts    # Zod schemas for the collections above
├── components/          # Header, Footer, cards, FAQ accordion, CTA sections, etc.
├── layouts/Layout.astro # Base HTML shell, meta tags, JSON-LD
├── lib/schema.ts         # JSON-LD (Organization, Service, FAQPage, BreadcrumbList, ...) helpers
└── pages/                # Route templates, including dynamic [slug].astro pages per collection
```

## Commands

| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the local dev server (`astro dev --background` to run it detached — see `astro dev status` / `stop` / `logs`) |
| `npm run build` | Build the static site to `./dist/` |
| `npm run preview` | Preview the production build locally |

## Storyblok sync

`scripts/storyblok/` pushes the Markdown content in `src/content/` into a Storyblok space via the Management API — component schemas first, then every entry as a Story. Requires `STORYBLOK_MANAGEMENT_TOKEN` and `STORYBLOK_SPACE_ID` (see `.env.example`).

```
npm run storyblok:sync             # push components + stories
npm run storyblok:push-components  # schemas only
npm run storyblok:push-stories     # content only
```

`.github/workflows/storyblok-sync.yml` runs this automatically on every push that touches `src/content/**`, using the same two values stored as GitHub Actions repository secrets.

## SEO / GEO

Per-page JSON-LD, canonical URLs, OpenGraph/Twitter tags, `sitemap-index.xml` (via `@astrojs/sitemap`), `robots.txt`, and an `llms.txt` at the site root for AI-crawler retrieval.
