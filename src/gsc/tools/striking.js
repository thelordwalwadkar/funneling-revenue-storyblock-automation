import { CTR_BENCHMARK, RULES, runStriking } from '../engines/striking.js';
import { dataTable, notice, pageLink, priorityChip, statCards } from '../core/ui.js';
import { fmtInt, fmtNum, fmtPct, fmtPos, h, monthEnd, monthStart, addMonths, shortUrl } from '../core/util.js';

export const tool = {
  slug: 'striking-distance',
  title: 'Striking Distance',
  blurb: 'Find queries where one of your pages ranks just outside the top results, close enough that a modest push could win real clicks.',
  needs: { query: true, page: true },
  needsText: 'Query, Page, Clicks, Impressions and Position (a Date column is only needed to choose a time range).',
  rules: [
    'Keeps query + page pairs whose average position sits inside your band (default 4 to 20: page one below the top three, or page two).',
    `Requires real demand: at least max(${RULES.minImpressions}, 10% of the typical in-band pair's impressions). "Typical" means the median.`,
    `Estimates the clicks the page would earn at position ${RULES.targetPosition} using the benchmark click-through rates below, then subtracts the clicks it gets today. That gap is the estimated clicks to gain (never below zero).`,
    `Priority by estimated gain: High at ${RULES.high} or more, Medium at ${RULES.medium} or more, Low below that.`,
    `Benchmark CTR by position: ${Object.entries(CTR_BENCHMARK).map(([p, c]) => `${p}: ${(c * 100).toFixed(1)}%`).join(' · ')}.`,
  ],
  settings: [
    { key: 'range', label: 'Months to analyze', type: 'chips', default: '3', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['16', '16 months']] },
    { key: 'band', label: 'Striking-distance band (average position)', type: 'chips', default: 'both', options: [['both', 'Both (4-20)', { lo: 4, hi: 20 }], ['p1', 'Page 1, below top 3 (4-10)', { lo: 4, hi: 10 }], ['p2', 'Page 2 (11-20)', { lo: 11, hi: 20 }]], help: 'Choose a band, or type your own positions below.' },
    { key: 'lo', label: 'From position', type: 'number', default: 4, min: 1, max: 100, step: 0.5, half: true },
    { key: 'hi', label: 'To position', type: 'number', default: 20, min: 1, max: 100, step: 0.5, half: true },
    { key: 'brand', label: 'Brand terms to exclude (optional)', type: 'tags', placeholder: 'e.g. yourbrand', help: 'Comma separated. Leave empty to include every query. Branded queries are not an SEO opportunity.' },
    { key: 'rowCap', label: 'Max query + page rows', type: 'select', default: '100000', advanced: true, options: [['25000', '25,000'], ['100000', '100,000 (default)'], ['250000', '250,000']] },
  ],

  async run({ source, settings, anchor, log }) {
    const n = Number(settings.range);
    const from = monthStart(addMonths(anchor, -(n - 1)));
    const to = monthEnd(anchor);
    const rows = await source.get({ dims: ['query', 'page'], from, to, rowCap: Number(settings.rowCap), onProgress: log });
    if (!rows.length) throw new Error('No query and page data found for that period.');
    const lo = settings.lo ?? 4;
    const hi = settings.hi ?? 20;
    if (lo > hi) throw new Error('The best position in the band must be lower than the worst position.');
    return { ...runStriking(rows, { band: [lo, hi], brandTerms: settings.brand }), truncated: !!rows.truncated, band: [lo, hi], range: n, anchor };
  },

  render(res) {
    const s = res.summary;
    const box = h('div');
    if (res.truncated) box.append(notice('warn', 'The row limit was reached, so the long tail of low-traffic pairs may be missing. Raise the limit under Advanced options.'));
    box.append(
      statCards([
        { label: 'Opportunities', value: fmtInt(s.shown), hint: `of ${fmtInt(s.inBand)} pairs in the ${res.band[0]}–${res.band[1]} band` },
        { label: 'High', value: fmtInt(s.high), tone: s.high ? 'bad' : '', hint: '30+ clicks to gain' },
        { label: 'Medium', value: fmtInt(s.medium), hint: '5–30 clicks' },
        { label: 'Low', value: fmtInt(s.low) },
        { label: 'Clicks to gain', value: fmtInt(s.totalGain), tone: 'good', hint: `if each reached position ${RULES.targetPosition}` },
        { label: 'Demand floor', value: `${fmtInt(s.demandFloor)} impr.`, hint: 'smaller pairs are ignored' },
      ]),
      dataTable({
        columns: [
          { key: 'query', label: 'Query', value: (r) => r.query },
          { key: 'page', label: 'Page', className: 'url', render: (r) => pageLink(r.page, shortUrl(r.page, 60)), value: (r) => r.page },
          { key: 'priority', label: 'Priority', render: (r) => priorityChip(r.priority), value: (r) => r.priority, sortValue: (r) => ({ high: 3, medium: 2, low: 1 })[r.priority] },
          { key: 'position', label: 'Avg position', num: true, render: (r) => fmtPos(r.position), value: (r) => Number(r.position.toFixed(1)) },
          { key: 'impressions', label: 'Impressions', num: true, render: (r) => fmtInt(r.impressions), value: (r) => r.impressions },
          { key: 'clicks', label: 'Clicks', num: true, render: (r) => fmtInt(r.clicks), value: (r) => r.clicks },
          { key: 'ctr', label: 'CTR', num: true, render: (r) => fmtPct(r.ctr, 1), value: (r) => Number(r.ctr.toFixed(4)) },
          { key: 'benchmarkCtr', label: 'Benchmark CTR here', num: true, render: (r) => fmtPct(r.benchmarkCtr, 1), value: (r) => Number(r.benchmarkCtr.toFixed(4)) },
          { key: 'gain', label: 'Est. clicks to gain', num: true, render: (r) => h('strong', null, fmtNum(r.gain, 0)), value: (r) => Math.round(r.gain) },
        ],
        rows: res.rows,
        defaultSort: { key: 'gain', dir: 'desc' },
        filter: { get: (r) => r.priority, options: [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }] },
        search: { placeholder: 'Search queries or pages…', text: (r) => `${r.query} ${r.page}` },
        csvName: `striking-distance-${res.anchor}.csv`,
        pageSize: 50,
        empty: 'No query and page pairs match. Try widening the band or the time range.',
      }),
    );
    return box;
  },
};
