// Keyword Cannibalization — queries where two or more of your own URLs compete.
//
// Input rows: { month?:'YYYY-MM', query, page, clicks, impressions, position }
// Rules (fixed, printed on the tool page):
//   * keep queries where >= 2 of your pages appear, counting a page only if its average position is within the
//     chosen depth (a page with no position is always kept)
//   * each month, the page ranking best is the "leader"; count how often the leader changes between months
//   * queries with total clicks < max(3, 10% of the typical query) go to a separate low-traffic section (by impressions)
//   * HIGH   : two best-ranked pages within 3 positions, or the leader changed in >= half of the monthly transitions (needs >= 2)
//     LOW    : one page takes >= 85% of the clicks
//     MEDIUM : everything else
import { Agg, addMonths, inFolder, makeBrandMatcher, makeKeywordMatcher, median, monthsBetween, normalizeFolder } from '../core/util.js';

export const RULES = { closeGap: 3, swapShare: 0.5, minTransitions: 2, ownerShare: 0.85, lowFloorMin: 3, lowFloorShare: 0.1 };
export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function runCannibalization(rows, { anchorMonth, range = 12, keywords = [], folder = '', maxPosition = 20, brandTerms = [] } = {}) {
  if (!anchorMonth) throw new Error('anchorMonth is required');
  const months = new Set(monthsBetween(addMonths(anchorMonth, -(range - 1)), anchorMonth));
  const f = normalizeFolder(folder);
  const isBrand = makeBrandMatcher(brandTerms);
  const keep = makeKeywordMatcher(keywords);

  // query -> page -> { all: Agg, months: Map<month, Agg> }
  const byQuery = new Map();
  let hasMonths = false;
  for (const r of rows) {
    if (!r.query || !r.page) continue;
    if (r.month && !months.has(r.month)) continue;
    if (isBrand(r.query) || !keep(r.query)) continue;
    let pm = byQuery.get(r.query);
    if (!pm) byQuery.set(r.query, (pm = new Map()));
    let o = pm.get(r.page);
    if (!o) pm.set(r.page, (o = { all: new Agg(), months: new Map() }));
    o.all.add(r);
    if (r.month) {
      hasMonths = true;
      let a = o.months.get(r.month);
      if (!a) o.months.set(r.month, (a = new Agg()));
      a.add(r);
    }
  }

  const candidates = [];
  for (const [query, pm] of byQuery) {
    if (pm.size < 2) continue;
    const competing = [];
    for (const [page, o] of pm) {
      const pos = o.all.position;
      if (maxPosition != null && pos != null && pos > maxPosition) continue;
      competing.push({ page, clicks: o.all.clicks, impressions: o.all.impressions, position: pos, months: o.months });
    }
    if (competing.length < 2) continue;
    if (f && !competing.every((p) => inFolder(p.page, f))) continue;

    // Monthly leader and how often it changes.
    const monthList = [...new Set(competing.flatMap((p) => [...p.months.keys()]))].sort();
    const leaders = [];
    for (const m of monthList) {
      let best = null;
      let bestPos = Infinity;
      let bestClicks = -1;
      for (const p of competing) {
        const a = p.months.get(m);
        if (!a) continue;
        const pos = a.position ?? Infinity;
        if (pos < bestPos || (pos === bestPos && (a.clicks > bestClicks || (a.clicks === bestClicks && best && p.page < best.page)))) {
          best = p;
          bestPos = pos;
          bestClicks = a.clicks;
        }
      }
      if (best) leaders.push(best.page);
    }
    let swaps = 0;
    for (let i = 1; i < leaders.length; i++) if (leaders[i] !== leaders[i - 1]) swaps++;
    const transitions = Math.max(0, leaders.length - 1);

    const totalClicks = competing.reduce((a, p) => a + p.clicks, 0);
    const totalImpressions = competing.reduce((a, p) => a + p.impressions, 0);
    competing.forEach((p) => {
      p.leaderMonths = leaders.filter((l) => l === p.page).length;
    });
    candidates.push({ query, competing, swaps, transitions, totalClicks, totalImpressions });
  }

  const typical = median(candidates.map((c) => c.totalClicks));
  const lowFloor = Math.max(RULES.lowFloorMin, RULES.lowFloorShare * typical);

  const main = [];
  const low = [];
  for (const c of candidates) {
    const lowTraffic = c.totalClicks < lowFloor;
    const metric = lowTraffic ? 'impressions' : 'clicks';
    const total = lowTraffic ? c.totalImpressions : c.totalClicks;
    const pages = c.competing
      .map((p) => ({ ...p, months: undefined, share: total > 0 ? p[metric] / total : 0 }))
      .sort((a, b) => b[metric] - a[metric] || (a.position ?? 999) - (b.position ?? 999));
    const byPos = pages.filter((p) => p.position != null).sort((a, b) => a.position - b.position);
    const gap = byPos.length >= 2 ? byPos[1].position - byPos[0].position : null;
    const topShare = pages[0].share;

    let priority;
    let reason;
    if (gap !== null && gap <= RULES.closeGap) {
      priority = 'high';
      reason = `The two best-ranked pages are only ${gap.toFixed(1)} positions apart, so they are directly competing for the same result.`;
    } else if (c.transitions >= RULES.minTransitions && c.swaps / c.transitions >= RULES.swapShare) {
      priority = 'high';
      reason = `The ranking page changed in ${c.swaps} of ${c.transitions} month-to-month transitions.`;
    } else if (topShare >= RULES.ownerShare) {
      priority = 'low';
      reason = `One page takes ${Math.round(topShare * 100)}% of the ${metric}, so it is the clear owner.`;
    } else {
      priority = 'medium';
      reason = 'The ' + metric + ' are spread across the pages with no obvious owner.';
    }

    const item = {
      query: c.query,
      pages,
      pageCount: pages.length,
      totalClicks: c.totalClicks,
      totalImpressions: c.totalImpressions,
      bestPosition: byPos.length ? byPos[0].position : null,
      gap,
      swaps: c.swaps,
      transitions: c.transitions,
      swapIndicator: c.swaps > 0,
      priority,
      reason,
      lowTraffic,
      leader: pages[0].page,
    };
    (lowTraffic ? low : main).push(item);
  }
  const sorter = (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.totalClicks - a.totalClicks || b.totalImpressions - a.totalImpressions;
  main.sort(sorter);
  low.sort(sorter);

  const all = [...main, ...low];
  return {
    main,
    low,
    hasMonths,
    summary: {
      queriesAnalysed: byQuery.size,
      conflicts: all.length,
      clicksInvolved: all.reduce((a, c) => a + c.totalClicks, 0),
      high: all.filter((c) => c.priority === 'high').length,
      medium: all.filter((c) => c.priority === 'medium').length,
      low: all.filter((c) => c.priority === 'low').length,
      lowFloor,
      typicalClicks: typical,
    },
  };
}

/** Classify a live-status probe of one competing page against the other page in the pair. */
export function classifyProbe(probe, otherUrl) {
  if (!probe || probe.error) return { status: 'unreachable', label: 'Could not be reached', tone: 'warn' };
  const norm = (u) => String(u || '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  if (probe.status === 404 || probe.status === 410) return { status: 'removed', label: `Removed (${probe.status})`, tone: 'warn' };
  if (probe.redirected && otherUrl && norm(probe.finalUrl) === norm(otherUrl)) return { status: 'merged', label: 'Redirects to the other page (likely already fixed)', tone: 'ok' };
  if (probe.redirected && probe.status >= 200 && probe.status < 300) return { status: 'redirect', label: `Redirects elsewhere → ${probe.finalUrl}`, tone: 'info' };
  if (probe.status >= 200 && probe.status < 300) return { status: 'live', label: 'Live', tone: 'info' };
  return { status: 'unreachable', label: `HTTP ${probe.status}`, tone: 'warn' };
}
