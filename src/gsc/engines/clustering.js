// Query Clustering: group search queries that carry the same intent, so one topic is planned and judged as one thing.
//
// Input rows: { query, page, clicks, impressions, position }  (one row per query + page, any time range)
//
// Rules (fixed, printed on the tool page):
//   * Queries are compared after dropping filler words and folding plurals ("pump", "pumps" -> "pump").
//   * Two queries join the same cluster when:
//       - they use the same words in any order, or
//       - the same page earns at least 30% of the impressions of BOTH of them and they share enough words
//         (Jaccard overlap of 0.34 or more, or one is fully contained in the other with 2+ words).
//     "Same page ranks for both" is the stand-in for "Google treats these as the same question".
//   * A cluster is "split" when two or more pages each hold 20% or more of its impressions.
//   * A cluster is "stuck" when its average position is worse than 10 and it is bigger than the typical cluster.
//   * A cluster is "owned" when one page holds 80% or more of its impressions.
import { Agg, makeBrandMatcher, median } from '../core/util.js';

export const RULES = {
  minImpressions: 10,
  pageShare: 0.3,
  jaccard: 0.34,
  splitShare: 0.2,
  ownerShare: 0.8,
  page1: 10,
  maxPerPage: 400,
};

export const VERDICT = { SPLIT: 'split', STUCK: 'stuck', OWNED: 'owned', MIXED: 'mixed' };
export const VERDICT_LABEL = {
  split: 'Split across pages',
  stuck: 'Stuck beyond page one',
  owned: 'One page owns it',
  mixed: 'Mixed',
};
export const VERDICT_ACTION = {
  split: 'Two or more of your pages share this topic. Choose the page that should own it, fold the others into it (or sharpen them to a different intent) and point internal links at the owner.',
  stuck: 'This topic has real demand but averages below page one. Build it out: more depth on the owning page, supporting pages that link to it, and clearer matching of the main phrase in the title and headings.',
  owned: 'One page already answers this topic. Protect it: keep it fresh, link to it from related pages and add the remaining phrasings from the list as headings or FAQs.',
  mixed: 'Traffic is spread over a few pages without a clear owner. Review the pages below and decide whether they serve different questions.',
};

const STOP = new Set(
  'a an and are as at be by can do does for from how i in is it its my of on or our so the this to us was we what when where which who why will with you your vs near me'.split(' '),
);

/** Lower-case words with filler removed and simple plurals folded. */
export function tokens(query) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const out = [];
  for (const w0 of words) {
    if (STOP.has(w0)) continue;
    let w = w0;
    if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    out.push(w);
  }
  return [...new Set(out)];
}

class DSU {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i) {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

function overlapOk(a, b) {
  if (!a.set.size || !b.set.size) return false;
  let inter = 0;
  for (const t of a.set) if (b.set.has(t)) inter++;
  if (!inter) return false;
  const union = a.set.size + b.set.size - inter;
  if (inter / union >= RULES.jaccard) return true;
  const smaller = a.set.size <= b.set.size ? a : b;
  return smaller.set.size >= 2 && inter === smaller.set.size;
}

export function runClustering(rows, { brandTerms = [], minImpressions = RULES.minImpressions } = {}) {
  const isBrand = makeBrandMatcher(brandTerms);
  // query -> { all, pages: Map<page, Agg> }
  const byQuery = new Map();
  for (const r of rows) {
    if (!r.query || !r.page || isBrand(r.query)) continue;
    let q = byQuery.get(r.query);
    if (!q) byQuery.set(r.query, (q = { all: new Agg(), pages: new Map() }));
    q.all.add(r);
    let pa = q.pages.get(r.page);
    if (!pa) q.pages.set(r.page, (pa = new Agg()));
    pa.add(r);
  }

  const items = [];
  for (const [query, q] of byQuery) {
    if (q.all.impressions < minImpressions) continue;
    const toks = tokens(query);
    if (!toks.length) continue;
    items.push({ query, ...q, set: new Set(toks), key: [...toks].sort().join(' ') });
  }
  items.sort((a, b) => b.all.impressions - a.all.impressions || a.query.localeCompare(b.query));

  const dsu = new DSU(items.length);

  // Rule 1: same words in any order.
  const byKey = new Map();
  items.forEach((it, i) => {
    const hit = byKey.get(it.key);
    if (hit == null) byKey.set(it.key, i);
    else dsu.union(hit, i);
  });

  // Rule 2: a shared page plus enough shared words.
  const byPage = new Map();
  items.forEach((it, i) => {
    for (const [page, pa] of it.pages) {
      if (it.all.impressions && pa.impressions / it.all.impressions >= RULES.pageShare) {
        let list = byPage.get(page);
        if (!list) byPage.set(page, (list = []));
        list.push(i);
      }
    }
  });
  for (const list of byPage.values()) {
    const cand = list.slice(0, RULES.maxPerPage); // items are already sorted by impressions
    for (let x = 0; x < cand.length; x++) for (let y = x + 1; y < cand.length; y++) if (dsu.find(cand[x]) !== dsu.find(cand[y]) && overlapOk(items[cand[x]], items[cand[y]])) dsu.union(cand[x], cand[y]);
  }

  const groups = new Map();
  items.forEach((it, i) => {
    const root = dsu.find(i);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(it);
  });

  const all = [];
  for (const members of groups.values()) {
    members.sort((a, b) => b.all.impressions - a.all.impressions || b.all.clicks - a.all.clicks || a.query.localeCompare(b.query));
    const total = new Agg();
    const pageAgg = new Map();
    for (const m of members) {
      total.clicks += m.all.clicks;
      total.impressions += m.all.impressions;
      total.posW += m.all.posW;
      total.wsum += m.all.wsum;
      for (const [page, pa] of m.pages) {
        let a = pageAgg.get(page);
        if (!a) pageAgg.set(page, (a = new Agg()));
        a.clicks += pa.clicks;
        a.impressions += pa.impressions;
        a.posW += pa.posW;
        a.wsum += pa.wsum;
      }
    }
    const pages = [...pageAgg]
      .map(([page, a]) => ({ page, clicks: a.clicks, impressions: a.impressions, position: a.position, share: total.impressions ? a.impressions / total.impressions : 0 }))
      .sort((a, b) => b.impressions - a.impressions);
    all.push({
      head: members[0].query,
      queryCount: members.length,
      clicks: total.clicks,
      impressions: total.impressions,
      position: total.position,
      pages,
      pageCount: pages.length,
      topPage: pages[0]?.page ?? '',
      members: members.map((m) => ({ query: m.query, clicks: m.all.clicks, impressions: m.all.impressions, position: m.all.position })),
    });
  }

  const multi = all.filter((c) => c.queryCount >= 2);
  const typical = median(multi.map((c) => c.impressions));
  for (const c of multi) {
    const strong = c.pages.filter((p) => p.share >= RULES.splitShare).length;
    if (strong >= 2) c.verdict = VERDICT.SPLIT;
    else if (c.position != null && c.position > RULES.page1 && c.impressions >= typical) c.verdict = VERDICT.STUCK;
    else if ((c.pages[0]?.share ?? 0) >= RULES.ownerShare) c.verdict = VERDICT.OWNED;
    else c.verdict = VERDICT.MIXED;
  }
  multi.sort((a, b) => b.impressions - a.impressions || a.head.localeCompare(b.head));

  const counts = { split: 0, stuck: 0, owned: 0, mixed: 0 };
  for (const c of multi) counts[c.verdict]++;
  return {
    clusters: multi,
    summary: {
      queriesAnalysed: items.length,
      queriesClustered: multi.reduce((s, c) => s + c.queryCount, 0),
      clusters: multi.length,
      standalone: all.length - multi.length,
      counts,
      typical,
      biggest: multi[0]?.head ?? null,
    },
  };
}
