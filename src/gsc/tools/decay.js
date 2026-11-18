import { dataTable, chip, deltaText, notice, pageLink, sparkline, statCards } from '../core/ui.js';
import { addMonths, fmtInt, fmtNum, fmtPct, h, monthEnd, monthLabel, monthStart, shortUrl } from '../core/util.js';
import { RULES, VERDICT, VERDICT_ACTION, VERDICT_LABEL, runDecay } from '../engines/decay.js';

const TONE = { healthy: 'ok', insufficient: 'muted', seasonal: 'info', refresh: 'high', meta: 'medium' };
const verdictChip = (v) => chip(VERDICT_LABEL[v], TONE[v]);

export const tool = {
  slug: 'content-decay',
  title: 'Content Decay',
  blurb: 'Find pages that have slipped from their own best period, and learn whether the cause is a real decline or simply the season.',
  needs: { page: true, time: true },
  needsText: 'Page, Date (or month), Clicks and Impressions. One row per page per month is enough.',
  rules: [
    'Recent = average monthly clicks over the last 3 completed months. The current, partial month is always left out.',
    'Peak = the highest 3-month average anywhere in the range you choose. Drop = how far Recent sits below Peak.',
    `If Peak is below ${RULES.minPeak} clicks a month the page is marked Insufficient data (too small to judge).`,
    `If the drop is under ${RULES.dropThreshold * 100}% the page is Healthy.`,
    `If the drop is ${RULES.dropThreshold * 100}% or more, the latest month is compared with the same month a year earlier (needs at least ${RULES.historyForYoY} months of history). Within ${RULES.seasonalTolerance * 100}% of last year = Seasonal pattern.`,
    `Otherwise it is a real decline. If impressions are down ${RULES.impressionsTolerance * 100}% or less (people still see the page, fewer click) = Meta or CTR fix needed. If impressions are down more = Content refresh needed.`,
  ],
  settings: [
    { key: 'range', label: 'Time range', type: 'chips', default: '16', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['16', '16 months (max)']], help: 'Search Console keeps about 16 months, the maximum available. The seasonal (year over year) check needs at least 13 months.' },
    { key: 'folder', label: 'Limit to a folder (optional)', type: 'text', placeholder: 'e.g. /blog/', help: 'Analyze only pages under a path, like /blog/ or /products/. Leave empty for the whole property.' },
    { key: 'rowCap', label: 'Max pages per month', type: 'select', default: '25000', advanced: true, options: [['25000', '25,000 (default)'], ['50000', '50,000'], ['100000', '100,000']], help: 'Search Console returns the highest-click pages first; this caps how deep we go per month.' },
  ],

  async run({ source, settings, anchor, log }) {
    const from = monthStart(addMonths(anchor, -(RULES.maxRange - 1)));
    const to = monthEnd(anchor);
    const rows = await source.get({ dims: ['page'], from, to, byMonth: true, filters: { pathPrefix: settings.folder }, rowCap: Number(settings.rowCap), onProgress: log });
    if (!rows.length) throw new Error('No page data found for that period.');
    const res = runDecay(rows, { anchorMonth: anchor, range: Number(settings.range), folder: settings.folder });
    return { ...res, truncated: !!rows.truncated, anchor };
  },

  render(res) {
    const { summary: s } = res;
    const box = h('div');
    if (res.truncated) box.append(notice('warn', 'Search Console returned the row limit for at least one month, so low-traffic pages may be missing. Raise "Max pages per month" under Advanced options to go deeper.'));
    if (!s.hasYoY) box.append(notice('warn', `Seasonality was not checked: it needs at least ${RULES.historyForYoY} months of history, and this data has fewer. Real declines and seasonal dips may look the same.`));
    box.append(
      statCards([
        { label: 'Pages analyzed', value: fmtInt(s.pages) },
        { label: 'Content refresh needed', value: fmtInt(s.counts.refresh), tone: s.counts.refresh ? 'bad' : '', hint: 'being shown less' },
        { label: 'Meta or CTR fix', value: fmtInt(s.counts.meta), tone: s.counts.meta ? 'bad' : '', hint: 'shown, but not clicked' },
        { label: 'Seasonal', value: fmtInt(s.counts.seasonal), hint: 'recurring low season' },
        { label: 'Healthy', value: fmtInt(s.counts.healthy), tone: 'good' },
        { label: 'Clicks / month at stake', value: fmtInt(s.clicksLost), hint: 'real declines only' },
      ]),
    );

    const last = monthLabel(res.anchor);
    const prev = monthLabel(addMonths(res.anchor, -1));
    const pageCol = { key: 'page', label: 'Page', className: 'url', render: (r) => pageLink(r.page, shortUrl(r.page, 80)), value: (r) => r.page };
    const verdictCol = { key: 'verdict', label: 'Verdict', render: (r) => verdictChip(r.verdict), value: (r) => VERDICT_LABEL[r.verdict] };
    const rolling = [
      pageCol, verdictCol,
      { key: 'peakClicks', label: 'Peak (avg clicks/mo)', num: true, render: (r) => h('span', { title: `${monthLabel(r.peakFrom)} – ${monthLabel(r.peakTo)}` }, fmtNum(r.peakClicks, 1)), value: (r) => Number(r.peakClicks.toFixed(1)) },
      { key: 'peakRange', label: 'Peak window', sortable: false, render: (r) => h('span', { class: 'small muted' }, r.peakFrom === r.peakTo ? monthLabel(r.peakFrom) : `${monthLabel(r.peakFrom)} – ${monthLabel(r.peakTo)}`), value: (r) => `${r.peakFrom} to ${r.peakTo}` },
      { key: 'recentClicks', label: 'Recent (avg clicks/mo)', num: true, render: (r) => fmtNum(r.recentClicks, 1), value: (r) => Number(r.recentClicks.toFixed(1)) },
      { key: 'drop', label: 'Drop', num: true, render: (r) => (r.drop > 0 ? deltaText(-r.drop, { d: 0 }) : h('span', { class: 'muted' }, '0%')), value: (r) => Number(r.drop.toFixed(4)) },
      { key: 'imprChange', label: 'Impressions vs peak', num: true, render: (r) => deltaText(r.imprChange, { d: 0 }), value: (r) => (r.imprChange == null ? '' : Number(r.imprChange.toFixed(4))) },
      { key: 'yoyChange', label: `${last} vs year ago`, num: true, render: (r) => deltaText(r.yoyChange, { d: 0 }), value: (r) => (r.yoyChange == null ? '' : Number(r.yoyChange.toFixed(4))) },
      { key: 'series', label: 'Trend', sortable: false, csv: false, render: (r) => sparkline(r.series) },
    ];
    const mom = [
      pageCol, verdictCol,
      { key: 'lastMonth', label: `${last} clicks`, num: true, render: (r) => fmtInt(r.lastMonth), value: (r) => r.lastMonth },
      { key: 'prevMonth', label: `${prev} clicks`, num: true, render: (r) => fmtInt(r.prevMonth), value: (r) => r.prevMonth },
      { key: 'momChange', label: 'Change', num: true, render: (r) => deltaText(r.momChange, { d: 0 }), value: (r) => (r.momChange == null ? '' : Number(r.momChange.toFixed(4))) },
      { key: 'series', label: 'Trend', sortable: false, csv: false, render: (r) => sparkline(r.series) },
    ];

    const holder = h('div');
    let view = 'rolling';
    const paint = () => {
      holder.replaceChildren(
        dataTable({
          columns: view === 'rolling' ? rolling : mom,
          rows: res.rows,
          defaultSort: { key: view === 'rolling' ? 'peakClicks' : 'lastMonth', dir: 'desc' },
          filter: { get: (r) => r.verdict, options: [VERDICT.REFRESH, VERDICT.META, VERDICT.SEASONAL, VERDICT.HEALTHY, VERDICT.INSUFFICIENT].map((v) => ({ value: v, label: VERDICT_LABEL[v] })) },
          search: { placeholder: 'Search pages…', text: (r) => r.page },
          csvName: `content-decay-${res.anchor}.csv`,
          expand: (r) => h('div', null, h('strong', null, VERDICT_LABEL[r.verdict]), ' — ', VERDICT_ACTION[r.verdict], h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Drop ${fmtPct(r.drop, 0)} · peak ${fmtNum(r.peakClicks, 1)} → recent ${fmtNum(r.recentClicks, 1)} clicks a month · ${last} ${fmtInt(r.latest)} vs ${fmtInt(r.yearAgo)} a year earlier`)),
          pageSize: 50,
          empty: 'No pages match.',
        }),
      );
    };
    const toggle = h('div', { class: 'filters' }, h('span', { class: 'small muted' }, 'View:'),
      ...[['rolling', '3-month averages (decides the verdict)'], ['mom', 'Month over month']].map(([v, label]) => h('button', { type: 'button', class: 'chip chip-filter', 'aria-pressed': String(v === view), onclick: (e) => {
        view = v;
        toggle.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        paint();
      } }, label)));
    paint();
    box.append(toggle, holder, h('p', { class: 'small muted' }, 'The month-over-month view only changes the columns. The verdict is always based on the 3-month averages.'));
    return box;
  },
};
