// Internal Link Gap: find pages that earn search impressions but are barely linked to from the rest of your site,
// and name the exact pages and phrases where a link could be added.
//
// Input: pages      = [{ page, clicks, impressions, position }]      from Search Console
//        queryPages = [{ query, page, clicks, impressions }]         from Search Console
//        crawl      = [{ url, status, title, text, links:[{ to, anchor }] }]   read from the live site
//
// Rules (fixed, printed on the tool page):
//   * Only links inside the page content count. Menu, header, footer and sidebar links are ignored because they
//     repeat on every page and say nothing about topic.
//   * Inbound links = how many OTHER crawled pages link to the page. The homepage is skipped (logo and menu reach it).
//   * A page is worth checking when its impressions reach the typical (median) page, or at least 30.
//   * Priority: High = 0 inbound links and impressions at or above the median;  Medium = 0 inbound with fewer
//     impressions, or 1 inbound with impressions at or above the median;  Low = 1 inbound with fewer impressions,
//     or 2 inbound while the page sits at positions 4 to 20 (close to page one).
//   * Link suggestions: for each under-linked page, take its three biggest search phrases. A crawled page that already
//     contains the exact phrase, and does not link there yet, is an easy place to add a link with that phrase as the
//     anchor. If no page has the exact phrase, pages containing every word of it are offered as partial matches.
import { makeBrandMatcher, median } from '../core/util.js';
import { tokens } from './clustering.js';

export const RULES = { minImpressions: 30, maxSuggestionsPerPage: 4, topQueries: 3, nearPageOne: [4, 20] };
export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/** Same page, different spelling: host without www, no hash/query, no trailing slash. */
export function normUrl(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/index\.(html?|php)$/i, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${p}`;
  } catch {
    return String(url || '').toLowerCase();
  }
}

function hasPhrase(text, phrase) {
  const t = ` ${text} `;
  const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!p) return false;
  return t.includes(` ${p} `) || t.includes(` ${p}.`) || t.includes(` ${p},`) || t.includes(` ${p}s `);
}

export function runLinkGap({ pages, queryPages = [], crawl, brandTerms = [] }) {
  const isBrand = makeBrandMatcher(brandTerms);
  const okPages = crawl.filter((c) => c.status >= 200 && c.status < 300);
  const failed = crawl.filter((c) => !(c.status >= 200 && c.status < 300));

  // Inbound contextual links, de-duplicated per source page.
  const inbound = new Map(); // normTarget -> Map(normSource -> anchor)
  const outgoing = new Map(); // normSource -> Set(normTarget)
  for (const c of okPages) {
    const src = normUrl(c.url);
    const out = new Set();
    for (const l of c.links || []) {
      const dst = normUrl(l.to);
      if (dst === src) continue;
      out.add(dst);
      let m = inbound.get(dst);
      if (!m) inbound.set(dst, (m = new Map()));
      if (!m.has(src)) m.set(src, l.anchor || '');
    }
    outgoing.set(src, out);
  }

  const perf = new Map();
  for (const p of pages) {
    const k = normUrl(p.page);
    const cur = perf.get(k) || { page: p.page, clicks: 0, impressions: 0, position: p.position };
    cur.clicks += p.clicks || 0;
    cur.impressions += p.impressions || 0;
    if (p.impressions >= (cur._bestImpr || 0)) {
      cur.page = p.page;
      cur._bestImpr = p.impressions;
      cur.position = p.position ?? cur.position;
    }
    perf.set(k, cur);
  }
  const all = [...perf.entries()].map(([key, p]) => ({ key, page: p.page, clicks: p.clicks, impressions: p.impressions, position: p.position }));
  const med = median(all.map((p) => p.impressions));
  const floor = Math.max(RULES.minImpressions, 0);

  const crawledSet = new Set(okPages.map((c) => normUrl(c.url)));
  const gaps = [];
  for (const p of all) {
    if (p.impressions < floor) continue;
    if (p.key.replace(/^[^/]*/, '') === '/') continue; // the homepage is reached through the logo and menu on every page
    const n = inbound.get(p.key)?.size ?? 0;
    const strong = p.impressions >= med;
    let priority = null;
    if (n === 0) priority = strong ? 'high' : 'medium';
    else if (n === 1) priority = strong ? 'medium' : 'low';
    else if (n === 2 && p.position != null && p.position >= RULES.nearPageOne[0] && p.position <= RULES.nearPageOne[1]) priority = 'low';
    if (!priority) continue;
    gaps.push({ ...p, inbound: n, priority, crawled: crawledSet.has(p.key), linkedFrom: [...(inbound.get(p.key)?.keys() ?? [])] });
  }
  gaps.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.impressions - a.impressions || a.page.localeCompare(b.page));

  // Link suggestions.
  const qByPage = new Map();
  for (const r of queryPages) {
    if (!r.query || !r.page || isBrand(r.query)) continue;
    const k = normUrl(r.page);
    let m = qByPage.get(k);
    if (!m) qByPage.set(k, (m = new Map()));
    const cur = m.get(r.query) || { query: r.query, impressions: 0, clicks: 0 };
    cur.impressions += r.impressions || 0;
    cur.clicks += r.clicks || 0;
    m.set(r.query, cur);
  }
  const srcInfo = okPages.map((c) => {
    const key = normUrl(c.url);
    return { url: c.url, key, title: c.title || '', text: String(c.text || '').toLowerCase(), words: new Set(tokens(c.text || '')), impressions: perf.get(key)?.impressions ?? 0 };
  });

  const suggestions = [];
  for (const g of gaps) {
    const qs = [...(qByPage.get(g.key)?.values() ?? [])].filter((q) => q.impressions >= 5).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks).slice(0, RULES.topQueries);
    const used = new Set();
    const mine = [];
    for (const q of qs) {
      const exact = [];
      const partial = [];
      const qt = tokens(q.query);
      for (const s of srcInfo) {
        if (s.key === g.key || used.has(s.key) || outgoing.get(s.key)?.has(g.key)) continue;
        if (hasPhrase(s.text, q.query)) exact.push(s);
        else if (qt.length >= 2 && qt.every((t) => s.words.has(t))) partial.push(s);
      }
      exact.sort((a, b) => b.impressions - a.impressions || a.url.localeCompare(b.url));
      partial.sort((a, b) => b.impressions - a.impressions || a.url.localeCompare(b.url));
      const pick = [...exact.map((s) => ({ s, match: 'exact' })), ...(exact.length ? [] : partial.map((s) => ({ s, match: 'partial' })))].slice(0, 2);
      for (const { s, match } of pick) {
        if (mine.length >= RULES.maxSuggestionsPerPage) break;
        used.add(s.key);
        mine.push({ target: g.page, targetPriority: g.priority, source: s.url, sourceTitle: s.title, anchor: q.query, match, queryImpressions: q.impressions, sourceImpressions: s.impressions });
      }
    }
    g.suggestions = mine.length;
    suggestions.push(...mine);
  }

  return {
    gaps,
    suggestions,
    failed: failed.map((c) => ({ url: c.url, status: c.status, error: c.error || '' })),
    summary: {
      pagesChecked: all.length,
      crawled: okPages.length,
      failed: failed.length,
      underLinked: gaps.length,
      high: gaps.filter((g) => g.priority === 'high').length,
      medium: gaps.filter((g) => g.priority === 'medium').length,
      low: gaps.filter((g) => g.priority === 'low').length,
      suggestions: suggestions.length,
      medianImpressions: med,
    },
  };
}
