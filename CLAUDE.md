## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Project rules (Funneling Revenue)

**What this is:** revenue-first marketing site for manufacturers. Astro static pages plus a small Node backend (`src/pages/api/`, `src/lib/server/`) in one container. Content lives in `src/content/*.md` and syncs both ways with Storyblok.

**Brand:** blue `#1E4A6B` and orange `#B45309` (sampled from the logo) on `#FCFCFB`. Change colours only in the `@theme` block of `src/styles/global.css`. Display font is Source Serif 4.

**Content rules**
- Never invent clients, metrics or quotes. Case-study numbers must come from the user.
- Every Markdown field must exist in `src/content.config.ts` AND `scripts/storyblok/mappers.mjs`. After changing either, run `npm run storyblok:test`.
- Every page needs a unique `metaTitle` (<= 60 chars) and `metaDescription` (70-160 chars).

**Backend rules**
- API routes need a trailing slash (`/api/lead/`) because `trailingSlash: 'always'`.
- Any server code that fetches a user-supplied URL must go through `safeFetch` in `src/lib/server/safe-fetch.ts`. Never call `fetch` on user input directly.
- Never commit `.env` or the `data/` folder (visitor submissions).

**Working rules**
- Do not commit, push or deploy unless asked. A push to `main` touching `src/content/**` triggers the Storyblok sync workflow.
- The BNI scrapers in `C:\Users\ShubhamWalwadkar\projects\bni-report` stay private and local. Do not expose them on the website, and never parallelise requests to bniconnectglobal.com.
- Verify UI changes with `npm run build`, then `npm start` and load the page. A passing build does not prove the page works.
- Shell note: this machine's Bash tool breaks on heredocs containing apostrophes; use the Write tool for files.
