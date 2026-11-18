// Index Bloat: find URLs that Google shows (or you submit) but that earn nothing, so crawl effort and authority
// are not spent on them.
//
// Input: pages = [{ page, clicks, impressions, position }]  (one row per URL over the range you chose)
//        sitemapUrls = optional list of URLs from the sitemap(s)
//
// Rules (fixed, printed on the tool page). Each URL gets the FIRST reason that applies:
//   1. Parameter URL      : has a "?" query string (filters, sorting, tracking, sessions).
//   2. Duplicate variant  : the same page under another address (http/https, www, trailing slash, index.html, case);
//                           the variant with the most clicks is kept as the main one, the others are flagged.
//   3. Low-value pattern  : path looks like tag/category/author/page-N/search/feed/print/cart/login archives.
//   4. Barely seen        : at most 50 impressions and no clicks in the range.
// Extra checks when a sitemap is available:
//   * In the sitemap, but zero impressions in the range -> "silent" (probably not indexed, or not wanted).
//   * Gets impressions, but is missing from the sitemap -> "unlisted".
// Folder check: a folder is a bloat candidate when it holds 15% or more of all URLs but 5% or less of all clicks.

export const RULES = { barelySeenImpressions: 50, folderUrlShare: 0.15, folderClickShare: 0.05, minFolderUrls: 5 };

export const REASON = { PARAMS: 'params', DUPLICATE: 'duplicate', PATTERN: 'pattern', BARELY: 'barely' };
export const REASON_LABEL = {
  params: 'Parameter URL',
  duplicate: 'Duplicate variant',
  pattern: 'Low-value pattern',
  barely: 'Barely seen, never clicked',
};
export const REASON_ACTION = {
  params: 'Keep parameter versions out of the index: add a canonical tag to the clean URL, or block the parameter in robots.txt if it only filters or sorts.',
  duplicate: 'Pick one address as the main version, 301-redirect the others to it and make sure the canonical tag and sitemap use only that address.',
  pattern: 'Archives like tags, categories, author pages and paginated lists rarely deserve their own index entry. Add noindex (keep following links) unless the page has unique content people search for.',
  barely: 'Google shows this URL but nobody clicks. Improve it, merge it into a stronger page, or set noindex or remove it if it adds nothing.',
};

const PATTERNS = [
  /\/(tag|tags|category|categories|cat|author|authors|archive|archives)(\/|$)/i,
  /\/page\/\d+/i,
  /[?&/]paged?=\d+/i,
  /\/(search|s)(\/|\?|$)/i,
  /\/(feed|rss|amp|print|trackback|embed)(\/|$)/i,
  /\/(cart|checkout|basket|my-account|account|login|signin|sign-in|register|wishlist|compare)(\/|$)/i,
  /\/(wp-json|wp-admin|wp-content|cgi-bin)(\/|$)/i,
  /\/attachment\//i,
  /\/(filter|sort|orderby)(\/|=)/i,
];

export function canonicalKey(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.toLowerCase().replace(/\/index\.(html?|php)$/, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${p}`;
  } catch {
    return String(url || '').toLowerCase();
  }
}

export function hasParams(url) {
  try {
    return new URL(url).search.length > 1;
  } catch {
    return /\?/.test(String(url));
  }
}

export function matchesPattern(url) {
  let s = String(url || '');
  try {
    const u = new URL(s);
    s = u.pathname + u.search;
  } catch {
    /* use as given */
  }
  return PATTERNS.some((re) => re.test(s));
}

function folderOf(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    return seg.length > 1 ? `/${seg[0]}/` : '/';
  } catch {
    return '/';
  }
}

export function runIndexBloat(pages, { sitemapUrls = [] } = {}) {
  const hasSitemap = sitemapUrls.length > 0;
  const perf = new Map();
  for (const r of pages) {
    if (!r.page) continue;
    const cur = perf.get(r.page) || { page: r.page, clicks: 0, impressions: 0, position: null };
    cur.clicks += r.clicks || 0;
    cur.impressions += r.impressions || 0;
    cur.position = r.position ?? cur.position;
    perf.set(r.page, cur);
  }
  const list = [...perf.values()];

  // Duplicate variants: group everything we know about by canonical key.
  const groups = new Map();
  for (const p of list) {
    const k = canonicalKey(p.page);
    if (hasParams(p.page)) continue; // parameter URLs are reason 1 already; do not let them make a clean page look duplicated
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(p);
  }
  const duplicateOf = new Map();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const main = [...g].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.page.length - b.page.length)[0];
    for (const p of g) if (p !== main) duplicateOf.set(p.page, main.page);
  }

  const smSet = new Set(sitemapUrls);
  const smKeys = new Set(sitemapUrls.map(canonicalKey));
  const flagged = [];
  const counts = { params: 0, duplicate: 0, pattern: 0, barely: 0 };
  for (const p of list) {
    let reason = null;
    let main = null;
    if (hasParams(p.page)) reason = REASON.PARAMS;
    else if (duplicateOf.has(p.page)) {
      reason = REASON.DUPLICATE;
      main = duplicateOf.get(p.page);
    } else if (matchesPattern(p.page)) reason = REASON.PATTERN;
    else if (p.clicks === 0 && p.impressions <= RULES.barelySeenImpressions) reason = REASON.BARELY;
    const unlisted = hasSitemap && !smSet.has(p.page) && !smKeys.has(canonicalKey(p.page));
    if (reason) {
      counts[reason]++;
      flagged.push({ ...p, reason, main, unlisted });
    }
  }
  flagged.sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));

  const perfKeys = new Set(list.filter((p) => !hasParams(p.page)).map((p) => canonicalKey(p.page)));
  const silent = hasSitemap ? sitemapUrls.filter((u) => !perf.has(u) && !perfKeys.has(canonicalKey(u))).map((page) => ({ page })) : [];
  const unlisted = hasSitemap ? list.filter((p) => !smSet.has(p.page) && !smKeys.has(canonicalKey(p.page)) && !hasParams(p.page) && !matchesPattern(p.page)).sort((a, b) => b.impressions - a.impressions) : [];

  // Folder view over every URL we know about.
  const folders = new Map();
  const touch = (url) => {
    const f = folderOf(url);
    let o = folders.get(f);
    if (!o) folders.set(f, (o = { folder: f, urls: 0, earning: 0, clicks: 0, impressions: 0 }));
    return o;
  };
  for (const p of list) {
    const o = touch(p.page);
    o.urls++;
    o.clicks += p.clicks;
    o.impressions += p.impressions;
    if (p.clicks > 0) o.earning++;
  }
  for (const s of silent) touch(s.page).urls++;
  const totalUrls = [...folders.values()].reduce((n, f) => n + f.urls, 0);
  const totalClicks = list.reduce((n, p) => n + p.clicks, 0);
  const folderRows = [...folders.values()]
    .map((f) => {
      const urlShare = totalUrls ? f.urls / totalUrls : 0;
      const clickShare = totalClicks ? f.clicks / totalClicks : 0;
      return { ...f, urlShare, clickShare, candidate: f.urls >= RULES.minFolderUrls && urlShare >= RULES.folderUrlShare && clickShare <= RULES.folderClickShare };
    })
    .sort((a, b) => b.urls - a.urls);

  const earning = list.filter((p) => p.clicks > 0).length;
  const flaggedTotal = flagged.length + silent.length;
  return {
    flagged,
    silent,
    unlisted,
    folders: folderRows,
    hasSitemap,
    summary: {
      urlsSeen: list.length,
      urlsKnown: totalUrls,
      earning,
      earningShare: list.length ? earning / list.length : 0,
      counts,
      flagged: flagged.length,
      silent: silent.length,
      unlisted: unlisted.length,
      bloatShare: totalUrls ? flaggedTotal / totalUrls : 0,
      sitemapUrls: sitemapUrls.length,
      candidateFolders: folderRows.filter((f) => f.candidate).length,
    },
  };
}
