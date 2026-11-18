// Striking Distance — query/page pairs ranking just off the top, ranked by the clicks a small push would win.
//
// Input rows: { query, page, clicks, impressions, position }  (any granularity; they are re-aggregated per query+page)
// Rules (fixed, printed on the tool page):
//   * keep pairs whose average position is inside the band (default 4–20)
//   * require real demand: impressions >= max(20, 10% of the typical in-band pair's impressions)
//   * estimated gain = impressions × CTR benchmark at position 3 − clicks today (never below zero)
//   * HIGH >= 30 clicks, MEDIUM >= 5, LOW below that
import { Agg, makeBrandMatcher, median } from '../core/util.js';

export const CTR_BENCHMARK = {
  1: 0.285, 2: 0.155, 3: 0.11, 4: 0.08, 5: 0.061, 6: 0.047, 7: 0.037, 8: 0.03, 9: 0.025, 10: 0.022,
  11: 0.018, 12: 0.016, 13: 0.014, 14: 0.013, 15: 0.012, 16: 0.011, 17: 0.01, 18: 0.009, 19: 0.008, 20: 0.008,
};
export const RULES = { minImpressions: 20, demandShare: 0.1, targetPosition: 3, high: 30, medium: 5 };

/** Benchmark CTR for a fractional average position (linear between whole positions). */
export function benchmarkCtr(pos) {
  if (!(pos > 0)) return null;
  if (pos <= 1) return CTR_BENCHMARK[1];
  if (pos >= 20) return CTR_BENCHMARK[20];
  const lo = Math.floor(pos);
  const t = pos - lo;
  return CTR_BENCHMARK[lo] * (1 - t) + CTR_BENCHMARK[lo + 1] * t;
}

export function runStriking(rows, { band = [4, 20], brandTerms = [], targetPosition = RULES.targetPosition } = {}) {
  const [lo, hi] = band;
  const isBrand = makeBrandMatcher(brandTerms);
  const pairs = new Map();
  for (const r of rows) {
    if (!r.query || !r.page || isBrand(r.query)) continue;
    const k = `${r.query}\u0001${r.page}`;
    let o = pairs.get(k);
    if (!o) pairs.set(k, (o = { query: r.query, page: r.page, agg: new Agg() }));
    o.agg.add(r);
  }
  const inBand = [];
  for (const o of pairs.values()) {
    const pos = o.agg.position;
    if (pos != null && pos >= lo && pos <= hi) inBand.push(o);
  }
  const typicalImpr = median(inBand.map((o) => o.agg.impressions));
  const demandFloor = Math.max(RULES.minImpressions, RULES.demandShare * typicalImpr);
  const targetCtr = benchmarkCtr(targetPosition);

  const out = [];
  for (const o of inBand) {
    const a = o.agg;
    if (a.impressions < demandFloor) continue;
    const position = a.position;
    const potential = a.impressions * targetCtr;
    const gain = Math.max(0, potential - a.clicks);
    const bench = benchmarkCtr(position);
    out.push({
      query: o.query,
      page: o.page,
      clicks: a.clicks,
      impressions: a.impressions,
      ctr: a.ctr,
      position,
      benchmarkCtr: bench,
      ctrVsBenchmark: bench ? a.ctr / bench : null,
      potentialClicks: potential,
      gain,
      priority: gain >= RULES.high ? 'high' : gain >= RULES.medium ? 'medium' : 'low',
    });
  }
  out.sort((a, b) => b.gain - a.gain || b.impressions - a.impressions);
  return {
    rows: out,
    summary: {
      pairsAnalysed: pairs.size,
      inBand: inBand.length,
      shown: out.length,
      demandFloor,
      high: out.filter((r) => r.priority === 'high').length,
      medium: out.filter((r) => r.priority === 'medium').length,
      low: out.filter((r) => r.priority === 'low').length,
      totalGain: out.reduce((a, r) => a + r.gain, 0),
      queries: new Set(out.map((r) => r.query)).size,
    },
  };
}
