// Keyword Growth and Loss Detector are the same tool with the direction flipped.
import { CAUSES, CAUSE_HELP, RULES, resolvePeriods, runMovement } from '../engines/movement.js';
import { chip, dataTable, deltaText, notice, pageLink, priorityChip, statCards } from '../core/ui.js';
import { fmtInt, fmtNum, fmtPos, h, shortUrl } from '../core/util.js';

const periodFields = [
  { key: 'preset', label: 'Comparison periods', type: 'chips', default: '3', options: [['3', '3 vs 3'], ['6', '6 vs 6'], ['8', '8 vs 8'], ['custom', 'Custom']], help: 'Compares the most recent months with the same number of months just before them. Only completed calendar months are used. Search Console holds about 16 months, so both periods fit.' },
  { key: 'recentFrom', label: 'Recent period: from', type: 'date', showIf: (v) => v.preset === 'custom' },
  { key: 'recentTo', label: 'Recent period: to', type: 'date', showIf: (v) => v.preset === 'custom' },
  { key: 'earlierFrom', label: 'Earlier period: from', type: 'date', showIf: (v) => v.preset === 'custom' },
  { key: 'earlierTo', label: 'Earlier period: to', type: 'date', showIf: (v) => v.preset === 'custom' },
];

function makeTool(direction) {
  const growth = direction === 'growth';
  const causeTone = growth ? { new: 'ok', ranking: 'ok', demand: 'info', ctr: 'info', mixed: 'muted', shift: 'muted' } : { new: 'high', ranking: 'high', demand: 'medium', ctr: 'medium', mixed: 'muted', shift: 'muted' };
  const word = growth ? 'gained' : 'lost';
  return {
    slug: growth ? 'keyword-growth' : 'loss-detector',
    title: growth ? 'Keyword Growth' : 'Loss Detector',
    blurb: growth
      ? 'Compare two periods and find the queries that earned more clicks, along with what drove each gain: a brand-new ranking, a higher position, more searches, or a better click rate.'
      : 'Compare two periods and find the queries that now earn fewer clicks, along with what drove each drop. Traffic that only moved between your own pages is listed separately.',
    needs: { query: true, time: true },
    needsText: 'Query, Date (or month), Clicks, Impressions and Position. A Page column is optional but lets the tool spot internal shifts between your own pages.',
    rules: [
      `For each query, the change is ${growth ? 'the recent period\'s clicks minus the earlier period\'s clicks' : 'the earlier period\'s clicks minus the recent period\'s clicks'}.`,
      `Significance floor = max(${RULES.minFloor} clicks, ${RULES.floorShare * 100}% of the typical query's clicks; "typical" = the median). A query is shown only when its clicks ${growth ? 'rose' : 'fell'} by at least this floor.`,
      growth
        ? `New keyword win: the earlier period held ${RULES.newShare * 100}% or less of the recent period's clicks. Ranking growth: position improved by more than ${RULES.posTolerance} and impressions rose more than ${RULES.imprTolerance * 100}%. Demand growth: position held (within ${RULES.posTolerance}) but impressions rose more than ${RULES.imprTolerance * 100}%. CTR growth: position and impressions both held but clicks rose. Mixed: the signals point different ways.`
        : `Keyword lost: the recent period holds ${RULES.newShare * 100}% or less of the earlier period's clicks. Ranking drop: position fell by more than ${RULES.posTolerance} and impressions fell more than ${RULES.imprTolerance * 100}%. Demand drop: position held but impressions fell more than ${RULES.imprTolerance * 100}%. CTR drop: position and impressions held but clicks fell. Mixed: the signals point different ways.`,
      `Internal shifts: using each query's per-page split, if the opposing movement on other pages is at least ${RULES.shiftShare * 100}% of the movement with the trend, the query is set aside as an internal shift rather than counted as real ${growth ? 'growth' : 'loss'}.`,
      `Priority by size of change relative to the floor: High at ${RULES.high}× or more, Medium at ${RULES.medium}× or more, Low below that.`,
    ],
    settings: [
      ...periodFields,
      { key: 'brand', label: 'Brand terms to exclude', type: 'tags', placeholder: 'e.g. yourbrand, your brand name', help: 'Comma separated. Queries containing any of these are left out, since brand swings usually are not the wins or losses you can act on.' },
      { key: 'rowCap', label: 'Max query + page rows per period', type: 'select', default: '100000', advanced: true, options: [['25000', '25,000'], ['100000', '100,000 (default)'], ['250000', '250,000']] },
    ],

    async run({ source, settings, anchor, log }) {
      const periods = resolvePeriods({ preset: settings.preset, anchorMonth: anchor, custom: settings });
      for (const [k, w] of Object.entries(periods)) if (!w.from || !w.to || w.from > w.to) throw new Error(`Check the ${k} period dates: the start must be on or before the end.`);
      const get = (w) => source.get({ dims: ['query', 'page'], from: w.from, to: w.to, rowCap: Number(settings.rowCap), onProgress: log });
      const recent = await get(periods.recent);
      const earlier = await get(periods.earlier);
      if (!recent.length || !earlier.length) throw new Error(`No data found for the ${!recent.length ? 'recent' : 'earlier'} period (${(!recent.length ? periods.recent : periods.earlier).from} to ${(!recent.length ? periods.recent : periods.earlier).to}).`);
      return { ...runMovement(recent, earlier, { direction, brandTerms: settings.brand }), periods, truncated: !!(recent.truncated || earlier.truncated), anchor };
    },

    render(res) {
      const s = res.summary;
      const box = h('div');
      if (res.truncated) box.append(notice('warn', 'The row limit was reached, so low-traffic queries may be missing. Raise the limit under Advanced options.'));
      box.append(
        h('p', { class: 'small muted' }, `Recent: ${res.periods.recent.from} → ${res.periods.recent.to} · Earlier: ${res.periods.earlier.from} → ${res.periods.earlier.to}`),
        statCards([
          { label: 'Queries analyzed', value: fmtInt(s.queriesAnalysed) },
          { label: growth ? 'Growing queries' : 'Losing queries', value: fmtInt(s.shown), tone: growth ? 'good' : 'bad', hint: `change of ${fmtNum(s.floor, 0)}+ clicks` },
          { label: `Clicks ${word}`, value: fmtInt(s.totalChange), tone: growth ? 'good' : 'bad' },
          { label: 'High priority', value: fmtInt(s.high) },
          { label: 'Internal shifts', value: fmtInt(res.shifts.length), hint: 'set aside' },
          { label: 'Significance floor', value: `${fmtNum(s.floor, 0)} clicks`, hint: `typical query ${fmtNum(s.typicalClicks, 0)}` },
        ]),
      );
      const detail = (r) => h('div', null,
        h('p', null, h('strong', null, r.causeLabel), ': ', r.cause === 'shift' ? 'Traffic moved between your own pages for this query, so it is not counted as real change.' : CAUSE_HELP[direction][r.cause]),
        r.pages.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
              h('thead', null, h('tr', null, ['Page', 'Recent clicks', 'Earlier clicks', 'Change'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
              h('tbody', null, r.pages.map((p) => h('tr', null, h('td', { class: 'url' }, pageLink(p.page, shortUrl(p.page, 90))), h('td', { class: 'num' }, fmtInt(p.recent)), h('td', { class: 'num' }, fmtInt(p.earlier)), h('td', { class: 'num' }, deltaText(p.recent - p.earlier, { pct: false })))))))
          : null);
      const cols = [
        { key: 'query', label: 'Query', value: (r) => r.query },
        { key: 'cause', label: 'Cause', render: (r) => chip(r.causeLabel, causeTone[r.cause]), value: (r) => r.causeLabel },
        { key: 'priority', label: 'Priority', render: (r) => priorityChip(r.priority), value: (r) => r.priority, sortValue: (r) => ({ high: 3, medium: 2, low: 1 })[r.priority] },
        { key: 'change', label: growth ? 'Clicks gained' : 'Clicks lost', num: true, render: (r) => h('strong', null, `${growth ? '+' : '−'}${fmtInt(r.change)}`), value: (r) => Math.round(r.change) },
        { key: 'recent', label: 'Recent clicks', num: true, render: (r) => fmtInt(r.recent.clicks), value: (r) => r.recent.clicks },
        { key: 'earlier', label: 'Earlier clicks', num: true, render: (r) => fmtInt(r.earlier.clicks), value: (r) => r.earlier.clicks },
        { key: 'pos', label: 'Position (earlier → recent)', num: true, sortValue: (r) => r.posChange, render: (r) => `${fmtPos(r.earlier.position)} → ${fmtPos(r.recent.position)}`, csvValue: (r) => `${fmtPos(r.earlier.position)} -> ${fmtPos(r.recent.position)}` },
        { key: 'imprChange', label: 'Impressions', num: true, render: (r) => deltaText(r.imprChange, { d: 0 }), value: (r) => (r.imprChange == null ? '' : Number(r.imprChange.toFixed(4))) },
      ];
      const table = (rows, name, filtered) =>
        dataTable({
          columns: cols,
          rows,
          defaultSort: { key: 'change', dir: 'desc' },
          filter: filtered ? { get: (r) => r.cause, options: Object.entries(CAUSES[direction]).filter(([k]) => s.causeCounts[k]).map(([value, label]) => ({ value, label })) } : null,
          search: { placeholder: 'Search queries…', text: (r) => r.query },
          csvName: name,
          expand: detail,
          pageSize: 40,
          empty: `No queries ${word} enough to pass the floor.`,
        });
      box.append(table(res.rows, `${growth ? 'keyword-growth' : 'loss-detector'}-${res.anchor}.csv`, true));
      if (res.shifts.length) {
        box.append(
          h('details', { class: 'rules', style: { marginTop: '18px' } },
            h('summary', null, `Internal shifts (${fmtInt(res.shifts.length)}): traffic that moved between your own pages, not counted above`),
            table(res.shifts, `${growth ? 'keyword-growth' : 'loss-detector'}-internal-shifts-${res.anchor}.csv`, false)),
        );
      }
      if (!s.hasPages) box.append(notice('info', 'This data has no Page column, so internal shifts could not be checked.'));
      return box;
    },
  };
}

export const growthTool = makeTool('growth');
export const lossTool = makeTool('loss');
