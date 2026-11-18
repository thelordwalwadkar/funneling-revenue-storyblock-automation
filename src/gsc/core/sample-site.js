// Sample data for the three reports (Internal Link Gap, Index Bloat, Query Clustering). It extends the made-up
// "acmefit" demo site with the things those reports look for: parameter and tag URLs, duplicate addresses, a sitemap,
// and a small crawl of pages whose text mentions each other's topics. Deterministic; never sent anywhere.
import { DEMO_SITE } from './demo.js';
import { addMonths, monthsBetween } from './util.js';

const HOME = `${DEMO_SITE}/`;

/** Extra performance rows that exist only in the sample, one per URL per month for the last six months. */
export function sampleExtraRows(anchorMonth) {
  const months = monthsBetween(addMonths(anchorMonth, -5), anchorMonth);
  const extra = [
    [`${DEMO_SITE}/products/rowing-machines?sort=price`, 0, 420],
    [`${DEMO_SITE}/products/rowing-machines?color=black&size=l`, 0, 180],
    [`${DEMO_SITE}/blog/tag/yoga/`, 0, 640],
    [`${DEMO_SITE}/blog/tag/running/`, 0, 380],
    [`${DEMO_SITE}/blog/category/news/`, 1, 300],
    [`${DEMO_SITE}/blog/page/2/`, 2, 260],
    [`${DEMO_SITE}/cart/`, 0, 60],
    ['http://acmefit.example/blog/best-rowing-machines/', 3, 150],
    [`${DEMO_SITE}/blog/standing-desk-guide/`, 2, 90],
  ];
  for (let i = 1; i <= 14; i++) extra.push([`${DEMO_SITE}/blog/old-note-${i}`, 0, 3 + ((i * 7) % 28)]);
  const rows = [];
  for (const [page, clicks, impressions] of extra) {
    for (const month of months) {
      rows.push({ month, page, clicks: Math.round(clicks / 6), impressions: Math.max(1, Math.round(impressions / 6)), position: 14 + (page.length % 17) });
    }
  }
  return rows;
}

const topQueries = (rows, page, n) => {
  const m = new Map();
  for (const r of rows) if (r.page === page && r.query) m.set(r.query, (m.get(r.query) || 0) + r.impressions);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([q]) => q);
};

/**
 * Builds the sitemap and a small crawl from the demo rows.
 * rows: the clean demo rows (without the extras). Returns { sitemapUrls, crawlPages: Map(url -> result) }.
 */
export function buildSampleSite(rows) {
  const impr = new Map();
  for (const r of rows) impr.set(r.page, (impr.get(r.page) || 0) + r.impressions);
  const pages = [...impr].sort((a, b) => b[1] - a[1]).map(([p]) => p);

  // Sitemap: every real page except four, plus pages Google never shows.
  const sitemapUrls = [HOME, ...pages.filter((_, i) => i % 9 !== 4)];
  for (let i = 1; i <= 10; i++) sitemapUrls.push(`${DEMO_SITE}/guides/legacy-guide-${i}`);
  for (let i = 1; i <= 4; i++) sitemapUrls.push(`${DEMO_SITE}/blog/old-note-${i}`);

  // Link graph: a handful of high-traffic pages get no content links on purpose; the low-traffic tail gets none either.
  const orphans = new Set([5, 9, 14].filter((i) => i < pages.length));
  const linkable = pages.filter((_, i) => i < 25 && !orphans.has(i));
  const orphanHeads = [...orphans].map((i) => topQueries(rows, pages[i], 1)[0]).filter(Boolean);

  const crawlPages = new Map();
  const mk = (url, title, text, targets) =>
    crawlPages.set(url, {
      url,
      status: 200,
      title,
      text: text.toLowerCase(),
      textLength: text.length,
      links: targets.map((t) => ({ to: t, anchor: topQueries(rows, t, 1)[0] || 'read more' })),
    });
  mk(HOME, 'AcmeFit | Fitness gear and guides', 'Welcome to acmefit. Home gym equipment, buying guides and training advice. '.repeat(3), linkable.slice(0, 12));
  pages.forEach((url, i) => {
    const slug = url.split('/').pop().replace(/-/g, ' ');
    const own = topQueries(rows, url, 4);
    const sentences = [`${slug}.`, ...own.map((q) => `Many readers ask about ${q}.`), 'We test every product for months before we write about it, and update this page when something changes.'];
    // Pages that are not orphans mention the orphan pages' main topics without linking to them.
    if (!orphans.has(i) && i % 2 === 0) for (const q of orphanHeads) sentences.push(`If you are comparing options, see our notes on ${q} too.`);
    const targets = [];
    if (i % 3 !== 0) for (const step of [1, 2]) { const t = pages[(i + step) % pages.length]; if (linkable.includes(t) && t !== url) targets.push(t); }
    mk(url, `${slug} | AcmeFit`, sentences.join(' ').repeat(2), targets);
  });
  return { sitemapUrls, crawlPages, pages };
}

/** A stand-in for the report API that answers from the sample site instead of the internet. */
export function sampleReportApi(rows) {
  const site = buildSampleSite(rows);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    kind: 'sample',
    async sitemap() {
      await wait(250);
      return { urls: site.sitemapUrls, files: [`${DEMO_SITE}/sitemap.xml`], truncated: false };
    },
    async pages(urls) {
      await wait(120);
      return urls.map((u) => site.crawlPages.get(u) || { url: u, status: 404, links: [], text: '' });
    },
    async inspect(url) {
      await wait(80);
      const bad = /\?|\/tag\/|\/page\/|\/cart\/|old-note|^http:/.test(url);
      return bad
        ? { verdict: 'NEUTRAL', coverage: 'Crawled - currently not indexed', robots: 'ALLOWED', indexing: 'INDEXING_ALLOWED', lastCrawl: '', googleCanonical: '', userCanonical: '' }
        : { verdict: 'PASS', coverage: 'Submitted and indexed', robots: 'ALLOWED', indexing: 'INDEXING_ALLOWED', lastCrawl: '', googleCanonical: url, userCanonical: url };
    },
  };
}
