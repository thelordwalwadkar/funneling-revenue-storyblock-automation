---
name: add-case-study
description: Add a new case study to the site from facts the user supplies. Use when the user wants to publish a client result, case study or proof point.
---

# Add a case study

1. Ask for anything missing. Never invent numbers, quotes or client names. Required: client (or anonymise), industry, services used, duration, 2-4 headline metrics, what the funnel looked like before and after at ToFu / MoFu / BoFu, actions per stage.
2. Copy `src/content/case-studies/sany-india.md` as the template into `src/content/case-studies/<slug>.md` and replace every field. Keep the key set identical (schema is in `src/content.config.ts`).
3. `industry` must match a file in `src/content/industries/`; each `servicesUsed` entry must match a file in `src/content/services/`.
4. Set `order` after the last case study and point the previous last entry's `nextCaseStudy` at the new slug; set the new entry's `nextCaseStudy` to the first one.
5. Write `metaTitle` (<= 60 chars, ends with "| Funnelling Revenue") and `metaDescription` (70-160 chars).
6. Add the page to `public/llms.txt` under Proof.
7. Run `npm run storyblok:test` and `npm run build`. Report what changed. Do not commit unless asked.
