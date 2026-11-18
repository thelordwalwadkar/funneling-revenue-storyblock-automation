// Content Decay — pages that fell from their own peak, separated from ordinary seasonal dips.
//
// Input rows: { month:'YYYY-MM', page, clicks, impressions }  (one row per page per completed month)
// Rules (fixed, printed on the tool page):
//   recent   = average monthly clicks over the last 3 completed months
//   peak     = highest 3-month average clicks anywhere in the chosen range
//   drop     = how far recent sits below peak
//   peak < 10 clicks/month            -> INSUFFICIENT DATA
//   drop < 25%                        -> HEALTHY
//   drop >= 25% and the latest month is within 15% of the same month a year ago
//                                     -> SEASONAL PATTERN   (needs >= 13 months of history)
//   otherwise impressions down <= 10% -> META OR CTR FIX NEEDED
//             impressions down  > 10% -> CONTENT REFRESH NEEDED
import { addMonths, inFolder, mean, monthsBetween, normalizeFolder } from '../core/util.js';

export const RULES = {
  window: 3,
  minPeak: 10,
  dropThreshold: 0.25,
  seasonalTolerance: 0.15,
  impressionsTolerance: 0.1,
  historyForYoY: 13,
  maxRange: 16,
};

export const VERDICT = {
  HEALTHY: 'healthy',
  INSUFFICIENT: 'insufficient',
  SEASONAL: 'seasonal',
  REFRESH: 'refresh',
  META: 'meta',
};
export const VERDICT_LABEL = {
  healthy: 'Healthy',
  insufficient: 'Insufficient data',
  seasonal: 'Seasonal pattern',
  refresh: 'Content refresh needed',
  meta: 'Meta or CTR fix needed',
};
export const VERDICT_ACTION = {
  healthy: 'No action needed.',
  insufficient: 'Too little traffic to judge reliably.',
  seasonal: 'Looks like a recurring low season, not a decline. Re-check next season.',
  refresh: 'The page is being shown less. Update the content, add depth, refresh the data and links.',
  meta: 'People still see the page but fewer click. Rewrite the title and meta description, check for new SERP features.',
};

export function runDecay(rows, { anchorMonth, range = RULES.maxRange, folder = '' } = {}) {
  if (!anchorMonth) throw new Error('anchorMonth is required');
  range = Math.min(RULES.maxRange, Math.max(RULES.window, Math.round(range)));
  const f = normalizeFolder(folder);

  // Fixed 16-month history so the year-ago comparison is always available; `range` limits only the peak search.
  const hist = monthsBetween(addMonths(anchorMonth, -(RULES.maxRange - 1)), anchorMonth);
  const idx = new Map(hist.map((m, i) => [m, i]));
  const windowMonths = hist.slice(-range);
  const wIdx = windowMonths.map((m) => idx.get(m));
  const yearAgoIdx = idx.get(addMonths(anchorMonth, -12));

  let minMonth = null;
  const pages = new Map();
  for (const r of rows) {
    if (!r.page || !r.month) continue;
    if (minMonth === null || r.month < minMonth) minMonth = r.month;
    const i = idx.get(r.month);
    if (i === undefined) continue;
    if (f && !inFolder(r.page, f)) continue;
    let p = pages.get(r.page);
    if (!p) pages.set(r.page, (p = { c: new Array(hist.length).fill(0), i: new Array(hist.length).fill(0) }));
    p.c[i] += r.clicks || 0;
    p.i[i] += r.impressions || 0;
  }
  const hasYoY = minMonth !== null && minMonth <= addMonths(anchorMonth, -(RULES.historyForYoY - 1));

  const out = [];
  for (const [page, p] of pages) {
    const cs = wIdx.map((i) => p.c[i]);
    const is = wIdx.map((i) => p.i[i]);
    if (!cs.some((v) => v > 0)) continue;

    const n = cs.length;
    const recentClicks = mean(cs.slice(-RULES.window));
    const recentImpr = mean(is.slice(-RULES.window));
    let peakClicks = -1;
    let peakStart = 0;
    for (let s = 0; s + RULES.window <= n; s++) {
      const avg = mean(cs.slice(s, s + RULES.window));
      if (avg >= peakClicks) {
        peakClicks = avg;
        peakStart = s;
      }
    }
    const peakImpr = mean(is.slice(peakStart, peakStart + RULES.window));
    const drop = peakClicks > 0 ? (peakClicks - recentClicks) / peakClicks : 0;

    const latest = p.c[hist.length - 1];
    const prevMonth = p.c[hist.length - 2];
    const yearAgo = yearAgoIdx !== undefined ? p.c[yearAgoIdx] : 0;
    const yoyChange = hasYoY && yearAgo > 0 ? (latest - yearAgo) / yearAgo : null;
    const imprChange = peakImpr > 0 ? (recentImpr - peakImpr) / peakImpr : null;

    let verdict;
    if (peakClicks < RULES.minPeak) verdict = VERDICT.INSUFFICIENT;
    else if (drop < RULES.dropThreshold) verdict = VERDICT.HEALTHY;
    else if (yoyChange !== null && Math.abs(yoyChange) <= RULES.seasonalTolerance) verdict = VERDICT.SEASONAL;
    else if (imprChange === null || imprChange >= -RULES.impressionsTolerance) verdict = VERDICT.META;
    else verdict = VERDICT.REFRESH;

    out.push({
      page,
      verdict,
      peakClicks,
      peakFrom: windowMonths[peakStart],
      peakTo: windowMonths[peakStart + RULES.window - 1],
      recentClicks,
      drop,
      clicksLost: Math.max(0, peakClicks - recentClicks),
      imprChange,
      latest,
      yearAgo,
      yoyChange,
      lastMonth: latest,
      prevMonth,
      momChange: prevMonth > 0 ? (latest - prevMonth) / prevMonth : null,
      series: cs,
    });
  }
  out.sort((a, b) => b.clicksLost - a.clicksLost);

  const counts = Object.fromEntries(Object.values(VERDICT).map((v) => [v, 0]));
  for (const r of out) counts[r.verdict]++;
  return {
    rows: out,
    summary: { pages: out.length, counts, hasYoY, windowMonths, anchorMonth, clicksLost: out.filter((r) => r.verdict === VERDICT.REFRESH || r.verdict === VERDICT.META).reduce((a, r) => a + r.clicksLost, 0) },
  };
}
