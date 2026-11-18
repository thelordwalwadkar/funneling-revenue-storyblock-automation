// Rules for the three gated reports: query clustering, index bloat, internal link gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runClustering, tokens, VERDICT as CV } from '../../src/gsc/engines/clustering.js';
import { runIndexBloat, canonicalKey, hasParams, matchesPattern, REASON } from '../../src/gsc/engines/indexbloat.js';
import { runLinkGap, normUrl } from '../../src/gsc/engines/linkgap.js';

const row = (query, page, clicks, impressions, position = 8) => ({ query, page, clicks, impressions, position });
const A = 'https://x.com/pumps/';
const B = 'https://x.com/pumps/centrifugal/';
const C = 'https://x.com/valves/';

/* ------------------------------- clustering ------------------------------ */

test('tokens: drop filler words, fold plurals, keep numbers', () => {
  assert.deepEqual(tokens('How to choose the best pumps for 2 bar'), ['choose', 'best', 'pump', '2', 'bar']);
  assert.deepEqual(tokens('Valves & Batteries'), ['valve', 'battery']);
  assert.deepEqual(tokens('gas analysis'), ['gas', 'analysis']);
});

test('clustering: word-order variants and plurals always merge, even on different pages', () => {
  const res = runClustering([row('industrial pump', A, 5, 200), row('pump industrial', B, 1, 100), row('industrial pumps', C, 0, 50)]);
  assert.equal(res.clusters.length, 1);
  assert.equal(res.clusters[0].queryCount, 3);
  assert.equal(res.clusters[0].head, 'industrial pump');
});

test('clustering: a shared page plus word overlap merges; no shared page and low overlap does not', () => {
  const rows = [
    row('industrial pump manufacturers', A, 10, 300),
    row('industrial pump suppliers', A, 5, 200),
    row('pump manufacturers india', C, 2, 90), // different page and different words -> stays out
    row('centrifugal pump price', B, 3, 120),
  ];
  const res = runClustering(rows);
  assert.equal(res.clusters.length, 1);
  assert.deepEqual(res.clusters[0].members.map((m) => m.query), ['industrial pump manufacturers', 'industrial pump suppliers']);
  assert.equal(res.summary.standalone, 2);
});

test('clustering: a query needs a real share of a page to link through it', () => {
  // "industrial pump" gets only 10% of its impressions on page A, so it cannot be pulled into A's cluster.
  const rows = [
    row('industrial pump', A, 0, 100, 12),
    row('industrial pump', C, 9, 900, 4),
    row('industrial pump suppliers', A, 5, 200),
    row('industrial pump vendors', A, 5, 150),
  ];
  const res = runClustering(rows);
  const heads = res.clusters.map((c) => c.head);
  assert.ok(heads.includes('industrial pump suppliers'));
  assert.ok(!res.clusters.find((c) => c.head === 'industrial pump suppliers').members.some((m) => m.query === 'industrial pump'));
});

test('clustering: verdicts split, stuck, owned', () => {
  const rows = [
    // split: two pages each hold a big share
    row('hydraulic pump repair', A, 5, 300), row('hydraulic pump repair', B, 5, 300),
    row('hydraulic pump service', A, 2, 150), row('hydraulic pump service', B, 2, 150),
    // stuck: one page, but average position 18 and the biggest cluster by impressions
    row('gear box oil', C, 0, 5000, 18), row('gear box oils', C, 0, 4000, 18),
    // owned: one page holds everything and ranks well
    row('seal kit', 'https://x.com/seals/', 20, 400, 3), row('seal kits', 'https://x.com/seals/', 10, 300, 3),
  ];
  const by = Object.fromEntries(runClustering(rows).clusters.map((c) => [c.head, c.verdict]));
  assert.equal(by['hydraulic pump repair'], CV.SPLIT);
  assert.equal(by['gear box oil'], CV.STUCK);
  assert.equal(by['seal kit'], CV.OWNED);
});

test('clustering: brand terms and tiny queries are left out', () => {
  const res = runClustering([row('acme pump', A, 9, 500), row('acme pumps', A, 9, 500), row('rare thing', A, 0, 3), row('rare things', A, 0, 3)], { brandTerms: ['acme'] });
  assert.equal(res.clusters.length, 0);
  assert.equal(res.summary.queriesAnalysed, 0);
});

/* -------------------------------- index bloat ----------------------------- */

test('index bloat: helpers', () => {
  assert.equal(canonicalKey('http://www.X.com/Pumps/'), canonicalKey('https://x.com/pumps'));
  assert.equal(canonicalKey('https://x.com/a/index.html'), canonicalKey('https://x.com/a/'));
  assert.ok(hasParams('https://x.com/a/?sort=price'));
  assert.ok(!hasParams('https://x.com/a/'));
  assert.ok(matchesPattern('https://x.com/tag/pumps/'));
  assert.ok(matchesPattern('https://x.com/blog/page/3/'));
  assert.ok(!matchesPattern('https://x.com/products/pumps/'));
});

test('index bloat: the first matching reason wins and counts add up', () => {
  const pages = [
    { page: 'https://x.com/pumps/', clicks: 90, impressions: 4000, position: 6 },
    { page: 'https://x.com/pumps?sort=price', clicks: 0, impressions: 300, position: 15 }, // params
    { page: 'http://www.x.com/pumps/', clicks: 2, impressions: 80, position: 20 }, // duplicate of the first (different scheme + host)
    { page: 'https://x.com/tag/pumps/', clicks: 0, impressions: 900, position: 25 }, // pattern
    { page: 'https://x.com/old-note/', clicks: 0, impressions: 12, position: 40 }, // barely
    { page: 'https://x.com/seen-not-clicked/', clicks: 0, impressions: 700, position: 9 }, // seen a lot: a CTR problem, not bloat
  ];
  const res = runIndexBloat(pages);
  const reason = Object.fromEntries(res.flagged.map((f) => [f.page, f.reason]));
  assert.equal(reason['https://x.com/pumps?sort=price'], REASON.PARAMS);
  assert.equal(reason['http://www.x.com/pumps/'], REASON.DUPLICATE);
  assert.equal(reason['https://x.com/tag/pumps/'], REASON.PATTERN);
  assert.equal(reason['https://x.com/old-note/'], REASON.BARELY);
  assert.ok(!('https://x.com/seen-not-clicked/' in reason));
  assert.ok(!('https://x.com/pumps/' in reason));
  assert.equal(res.flagged.find((f) => f.reason === REASON.DUPLICATE).main, 'https://x.com/pumps/');
  assert.equal(res.summary.flagged, 4);
  assert.deepEqual(res.summary.counts, { params: 1, duplicate: 1, pattern: 1, barely: 1 });
  assert.equal(res.hasSitemap, false);
});

test('index bloat: sitemap comparison finds silent and unlisted URLs', () => {
  const pages = [
    { page: 'https://x.com/a/', clicks: 10, impressions: 500, position: 5 },
    { page: 'https://x.com/b/', clicks: 5, impressions: 300, position: 7 },
    { page: 'https://x.com/not-in-map/', clicks: 3, impressions: 200, position: 9 },
  ];
  const res = runIndexBloat(pages, { sitemapUrls: ['https://x.com/a/', 'https://x.com/b', 'https://x.com/silent-1/', 'https://x.com/silent-2/'] });
  assert.deepEqual(res.silent.map((s) => s.page).sort(), ['https://x.com/silent-1/', 'https://x.com/silent-2/']);
  assert.deepEqual(res.unlisted.map((u) => u.page), ['https://x.com/not-in-map/']); // /b matches /b/ once the trailing slash is ignored
  assert.equal(res.summary.sitemapUrls, 4);
});

test('index bloat: a folder with many URLs and almost no clicks is a candidate', () => {
  const pages = [{ page: 'https://x.com/products/', clicks: 500, impressions: 9000, position: 4 }];
  for (let i = 0; i < 30; i++) pages.push({ page: `https://x.com/archive/post-${i}/`, clicks: i === 0 ? 1 : 0, impressions: 100 + i, position: 20 });
  const f = runIndexBloat(pages).folders;
  assert.equal(f.find((x) => x.folder === '/archive/').candidate, true);
  assert.equal(f.find((x) => x.folder === '/').candidate, false);
});

/* ------------------------------ internal link gap ------------------------- */

const home = 'https://x.com/';
const page = (url, links = [], text = '') => ({ url, status: 200, title: url, text, links: links.map(([to, anchor]) => ({ to, anchor })) });

test('link gap: normUrl ignores www, hash, query and trailing slash', () => {
  assert.equal(normUrl('https://www.x.com/a/?utm=1#top'), normUrl('https://x.com/a'));
});

test('link gap: pages with no content links in are found and ranked by priority', () => {
  const pages = [
    { page: home, clicks: 50, impressions: 2000, position: 3 },
    { page: A, clicks: 20, impressions: 1500, position: 5 }, // linked from home
    { page: B, clicks: 1, impressions: 1600, position: 12 }, // nobody links here, above the median -> high
    { page: C, clicks: 0, impressions: 40, position: 30 }, // nobody links, small -> medium
  ];
  const crawl = [page(home, [[A, 'pumps']]), page(A, [[home, 'home']]), page(B, [[home, 'home']]), page(C)];
  const res = runLinkGap({ pages, crawl });
  const by = Object.fromEntries(res.gaps.map((g) => [g.page, g]));
  assert.equal(by[B].priority, 'high');
  assert.equal(by[B].inbound, 0);
  assert.ok(!by[home], 'the homepage is reached through the menu, so it is never reported as unlinked');
  assert.equal(by[C].priority, 'medium');
  assert.equal(by[A].priority, 'low'); // one link in, below the median: worth a look, not urgent
  assert.equal(res.gaps[0].page, B);
  assert.equal(res.summary.high, 1);
});

test('link gap: suggests pages that already say the phrase but do not link yet', () => {
  const pages = [
    { page: home, clicks: 10, impressions: 3000, position: 3 },
    { page: A, clicks: 8, impressions: 2500, position: 4 },
    { page: B, clicks: 1, impressions: 900, position: 14 },
  ];
  const queryPages = [row('centrifugal pump selection', B, 1, 600), row('how to size a centrifugal pump', B, 0, 200), row('acme pumps', B, 0, 400)];
  const crawl = [
    page(home, [[A, 'pumps']], 'welcome to x. we make pumps and valves'),
    page(A, [], 'our guide to centrifugal pump selection explains head, flow and npsh. read more about sizing.'),
    page(B, [], 'centrifugal pump selection starts here'),
  ];
  const res = runLinkGap({ pages, queryPages, crawl, brandTerms: ['acme'] });
  const sug = res.suggestions.filter((s) => s.target === B);
  assert.equal(sug.length, 1);
  assert.equal(sug[0].source, A);
  assert.equal(sug[0].anchor, 'centrifugal pump selection');
  assert.equal(sug[0].match, 'exact');
  // brand phrases are never suggested as anchors
  assert.ok(!res.suggestions.some((s) => /acme/.test(s.anchor)));
});

test('link gap: a source that already links to the target is not suggested; failed pages are reported', () => {
  const pages = [
    { page: home, clicks: 10, impressions: 3000, position: 3 },
    { page: B, clicks: 1, impressions: 900, position: 14 },
  ];
  const queryPages = [row('centrifugal pump selection', B, 1, 600)];
  const crawl = [
    page(home, [[B, 'selection guide']], 'we cover centrifugal pump selection'),
    { url: 'https://x.com/broken/', status: 404, links: [], text: '' },
  ];
  const res = runLinkGap({ pages, queryPages, crawl });
  assert.equal(res.suggestions.length, 0);
  assert.equal(res.summary.failed, 1);
  assert.equal(res.failed[0].status, 404);
});

test('link gap: the homepage is skipped even when nothing in the content links to it', () => {
  const pages = [
    { page: home, clicks: 90, impressions: 5000, position: 3 },
    { page: A, clicks: 5, impressions: 900, position: 9 },
  ];
  const res = runLinkGap({ pages, crawl: [page(home, [[A, 'pumps']]), page(A)] });
  assert.ok(!res.gaps.some((g) => g.page === home));
  assert.ok(res.gaps.some((g) => g.page === A));
});
