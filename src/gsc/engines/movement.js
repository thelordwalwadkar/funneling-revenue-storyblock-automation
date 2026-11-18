// Keyword Growth and Loss Detector share one engine: compare two periods, find queries whose clicks moved by
// more than a significance floor, tag each with its cause, and set aside "internal shifts" (a gain on one page
// of the query that is really a loss on another).
//
// Input: rows for the recent period and the earlier period, each { query, page?, clicks, impressions, position }.
// Rules (fixed, printed on the tool page):
//   change = recent − earlier (growth) or earlier − recent (loss)
//   floor  = max(5 clicks, 15% of the typical query's clicks); only changes >= floor are shown
//   growth causes: NEW KEYWORD WIN (earlier <= 20% of recent), RANKING GROWTH (pos better by > 0.5 and impressions > +10%),
//                  DEMAND GROWTH (pos steady within 0.5, impressions > +10%), CTR GROWTH (pos and impressions steady), MIXED
//   loss causes:   KEYWORD LOST (recent <= 20% of earlier), RANKING DROP, DEMAND DROP, CTR DROP, MIXED — mirrored
//   internal shift: opposing page movement >= 60% of the movement with the trend
//   priority: change / floor  >= 8 HIGH, >= 3 MEDIUM, else LOW
import { Agg, addMonths, makeBrandMatcher, median, monthEnd, monthStart } from '../core/util.js';

export const RULES = { minFloor: 5, floorShare: 0.15, newShare: 0.2, posTolerance: 0.5, imprTolerance: 0.1, shiftShare: 0.6, high: 8, medium: 3 };

export const CAUSES = {
  growth: {
    new: 'New keyword win',
    ranking: 'Ranking growth',
    demand: 'Demand growth',
    ctr: 'CTR growth',
    mixed: 'Mixed growth',
  },
  loss: {
    new: 'Keyword lost',
    ranking: 'Ranking drop',
    demand: 'Demand drop',
    ctr: 'CTR drop',
    mixed: 'Mixed loss',
  },
};
export const CAUSE_HELP = {
  growth: {
    new: 'The query barely existed in the earlier period.',
    ranking: 'The page moved up and impressions rose with it.',
    demand: 'Position held but more people searched.',
    ctr: 'Same position and visibility, but the listing is clicked more often.',
    mixed: 'The signals point different ways.',
  },
  loss: {
    new: 'The query has effectively vanished.',
    ranking: 'The page slipped down and impressions fell with it.',
    demand: 'Position held but fewer people searched.',
    ctr: 'Same position and visibility, but the listing is clicked less often.',
    mixed: 'The signals point different ways.',
  },
};

/** Turn a preset ('3' | '6' | '8' months) or custom dates into the two comparison windows. */
export function resolvePeriods({ preset = '3', anchorMonth, custom } = {}) {
  if (preset === 'custom') {
    return {
      recent: { from: custom.recentFrom, to: custom.recentTo },
      earlier: { from: custom.earlierFrom, to: custom.earlierTo },
    };
  }
  const n = parseInt(preset, 10);
  return {
    recent: { from: monthStart(addMonths(anchorMonth, -(n - 1))), to: monthEnd(anchorMonth) },
    earlier: { from: monthStart(addMonths(anchorMonth, -(2 * n - 1))), to: monthEnd(addMonths(anchorMonth, -n)) },
  };
}

export function runMovement(recentRows, earlierRows, { direction = 'growth', brandTerms = [] } = {}) {
  const sign = direction === 'growth' ? 1 : -1;
  const isBrand = makeBrandMatcher(brandTerms);
  const q = new Map();
  const entry = (query) => {
    let e = q.get(query);
    if (!e) q.set(query, (e = { query, R: new Agg(), E: new Agg(), pR: new Map(), pE: new Map() }));
    return e;
  };
  for (const [rows, key, pk] of [[recentRows, 'R', 'pR'], [earlierRows, 'E', 'pE']]) {
    for (const r of rows) {
      if (!r.query || isBrand(r.query)) continue;
      const e = entry(r.query);
      e[key].add(r);
      if (r.page) e[pk].set(r.page, (e[pk].get(r.page) || 0) + (r.clicks || 0));
    }
  }

  const typical = median([...q.values()].map((e) => Math.max(e.R.clicks, e.E.clicks)).filter((v) => v > 0));
  const floor = Math.max(RULES.minFloor, RULES.floorShare * typical);

  const rows = [];
  const shifts = [];
  for (const e of q.values()) {
    const change = sign * (e.R.clicks - e.E.clicks);
    if (change < floor) continue;

    // Per-page split: is the movement real, or just traffic moving between your own pages?
    const pages = [...new Set([...e.pR.keys(), ...e.pE.keys()])].map((page) => {
      const recent = e.pR.get(page) || 0;
      const earlier = e.pE.get(page) || 0;
      return { page, recent, earlier, delta: sign * (recent - earlier) };
    });
    const withTrend = pages.filter((p) => p.delta > 0).reduce((a, p) => a + p.delta, 0);
    const opposing = pages.filter((p) => p.delta < 0).reduce((a, p) => a - p.delta, 0);
    pages.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const posChange = e.R.position != null && e.E.position != null ? e.E.position - e.R.position : null; // + = improved
    const imprChange = e.E.impressions > 0 ? (e.R.impressions - e.E.impressions) / e.E.impressions : e.R.impressions > 0 ? Infinity : 0;
    const steadyPos = posChange !== null && Math.abs(posChange) <= RULES.posTolerance;
    const steadyImpr = Math.abs(imprChange) <= RULES.imprTolerance;

    let cause;
    if (direction === 'growth') {
      if (e.E.clicks <= RULES.newShare * e.R.clicks) cause = 'new';
      else if (posChange !== null && posChange > RULES.posTolerance && imprChange > RULES.imprTolerance) cause = 'ranking';
      else if (steadyPos && imprChange > RULES.imprTolerance) cause = 'demand';
      else if (steadyPos && steadyImpr) cause = 'ctr';
      else cause = 'mixed';
    } else if (e.R.clicks <= RULES.newShare * e.E.clicks) cause = 'new';
    else if (posChange !== null && -posChange > RULES.posTolerance && imprChange < -RULES.imprTolerance) cause = 'ranking';
    else if (steadyPos && imprChange < -RULES.imprTolerance) cause = 'demand';
    else if (steadyPos && steadyImpr) cause = 'ctr';
    else cause = 'mixed';

    const ratio = change / floor;
    const item = {
      query: e.query,
      recent: { clicks: e.R.clicks, impressions: e.R.impressions, position: e.R.position, ctr: e.R.ctr },
      earlier: { clicks: e.E.clicks, impressions: e.E.impressions, position: e.E.position, ctr: e.E.ctr },
      change,
      ratio,
      posChange,
      imprChange: Number.isFinite(imprChange) ? imprChange : null,
      cause,
      causeLabel: CAUSES[direction][cause],
      priority: ratio >= RULES.high ? 'high' : ratio >= RULES.medium ? 'medium' : 'low',
      pages: pages.slice(0, 6),
    };
    if (withTrend > 0 && opposing >= RULES.shiftShare * withTrend) shifts.push({ ...item, cause: 'shift', causeLabel: 'Internal shift', priority: 'low' });
    else rows.push(item);
  }
  rows.sort((a, b) => b.change - a.change);
  shifts.sort((a, b) => b.change - a.change);

  const causeCounts = {};
  for (const r of rows) causeCounts[r.cause] = (causeCounts[r.cause] || 0) + 1;
  return {
    rows,
    shifts,
    summary: {
      queriesAnalysed: q.size,
      shown: rows.length,
      floor,
      typicalClicks: typical,
      totalChange: rows.reduce((a, r) => a + r.change, 0),
      causeCounts,
      high: rows.filter((r) => r.priority === 'high').length,
      medium: rows.filter((r) => r.priority === 'medium').length,
      low: rows.filter((r) => r.priority === 'low').length,
      hasPages: [...q.values()].some((e) => e.pR.size || e.pE.size),
    },
  };
}
