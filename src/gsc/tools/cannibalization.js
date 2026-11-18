import { apiUrl, hasApi } from '../core/api.js';
import { toCountryCode, COUNTRIES } from '../core/countries.js';
import { chip, dataTable, notice, pageLink, priorityChip, statCards } from '../core/ui.js';
import { addMonths, fmtInt, fmtPct, fmtPos, h, monthEnd, monthStart, shortUrl } from '../core/util.js';
import { RULES, classifyProbe, runCannibalization } from '../engines/cannibalization.js';

const ADVICE = {
  high: 'Pick one page to own this query. Merge the weaker page into it (or 301-redirect it), or re-target the other page at a different intent. Then point internal links and anchor text at the owner.',
  medium: 'Check intent. If both pages answer the same question, consolidate them. If they serve different intents, sharpen each title and H1 so Google can tell them apart.',
  low: 'Low urgency: one page already owns the query. Leave it unless the other page is taking impressions you would rather keep.',
};

async function probe(config, url) {
  try {
    const res = await fetch(apiUrl(config, 'check', url));
    const j = await res.json();
    if (!res.ok) return { error: j.error || `HTTP ${res.status}` };
    return j;
  } catch (e) {
    return { error: e.message };
  }
}

function detail(item, { config }) {
  const canProbe = hasApi(config) && item.pages.every((p) => /^https?:\/\//i.test(p.page));
  const cells = item.pages.map((p) => ({ p, status: h('td', { class: 'small' }) }));
  const checkBtn = canProbe
    ? h('button', { type: 'button', class: 'btn secondary small', onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Checking…';
        await Promise.all(cells.map(async ({ p, status }) => {
          const other = item.pages.find((x) => x !== p)?.page;
          const verdict = classifyProbe(await probe(config, p.page), other);
          status.replaceChildren(chip(verdict.label, verdict.tone));
        }));
        e.target.textContent = 'Checked';
      } }, 'Check live status of these pages')
    : null;
  const head = ['Page', item.lowTraffic ? 'Impressions share' : 'Click share', 'Clicks', 'Impressions', 'Avg position', ...(item.hasMonths ? ['Months leading'] : []), 'Live status'];
  const numeric = new Set(['Clicks', 'Impressions', 'Avg position', 'Months leading']);
  return h('div', null,
    h('p', null, h('strong', null, 'Why this priority: '), item.reason),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, head.map((t) => h('th', { class: numeric.has(t) ? 'num' : '' }, t)))),
      h('tbody', null, cells.map(({ p, status }) => h('tr', null,
        h('td', { class: 'url' }, pageLink(p.page, shortUrl(p.page, 90)), p.page === item.leader ? [' ', chip('likely owner', 'ok')] : null),
        h('td', null, h('div', { class: 'bar', title: fmtPct(p.share, 0) }, h('i', { style: { width: `${Math.round(p.share * 100)}%` } })), fmtPct(p.share, 0)),
        h('td', { class: 'num' }, fmtInt(p.clicks)),
        h('td', { class: 'num' }, fmtInt(p.impressions)),
        h('td', { class: 'num' }, fmtPos(p.position)),
        item.hasMonths ? h('td', { class: 'num' }, fmtInt(p.leaderMonths)) : null,
        status)))),
    ),
    h('p', { style: { marginTop: '10px' } }, h('strong', null, 'What to do: '), ADVICE[item.priority]),
    checkBtn ? h('div', { class: 'btn-row' }, checkBtn, h('span', { class: 'small muted' }, 'Follows redirects and tells you whether each page is live, removed, or already redirects to the other page. Nothing is stored.')) : null,
  );
}

export const tool = {
  slug: 'keyword-cannibalization',
  title: 'Keyword Cannibalization',
  blurb: 'Find queries where two or more of your own pages compete with each other, ranked by how much each one needs attention.',
  needs: { query: true, page: true },
  needsText: 'Query, Page, Date (or month), Clicks, Impressions and Position. Without dates the audit still works but cannot detect ranking swaps.',
  rules: [
    "Keeps only queries where two or more of your pages appear, counting a page as competing only if its average position is within the depth you choose (a page with no position is always kept). For each page it totals clicks and impressions and takes an impression-weighted average position.",
    'Each month it notes which page ranked best (the leader) and counts how often the leader changes from one month to the next.',
    `Low-traffic queries (total clicks below max(${RULES.lowFloorMin}, 10% of the typical query)) move to a separate section and are measured by impressions.`,
    `High priority: the two best-ranked pages sit within ${RULES.closeGap} positions of each other, or the leader changed in at least half of the month-to-month transitions (needs at least ${RULES.minTransitions}). Either pattern suggests Google is torn between the pages.`,
    `Low priority: one page takes ${RULES.ownerShare * 100}% or more of the clicks, so it is the clear owner.`,
    'Medium priority: everything else. Traffic is spread across the pages with no obvious owner.',
    'With a folder set, a query only counts if every one of its competing pages sits under that folder.',
  ],
  settings: [
    { key: 'scope', label: 'What to check', type: 'chips', default: 'all', options: [['all', 'Whole site'], ['keywords', 'Specific keywords']], help: 'Scan every query on the property. Switch to keywords to focus on one topic cluster instead.' },
    { key: 'keywords', label: 'Keywords', type: 'tags', placeholder: 'e.g. centrifugal pump, gearbox', showIf: (v) => v.scope === 'keywords', help: 'Comma separated. A query is kept if it contains any of these.' },
    { key: 'brand', label: 'Brand terms to exclude', type: 'tags', placeholder: 'e.g. yourbrand, your brand name', help: 'Comma separated. Queries containing any of these are left out, since a brand query where one page rightly dominates is not cannibalization.' },
    { key: 'folder', label: 'Limit to a folder (optional)', type: 'text', placeholder: 'e.g. /blog/', half: true, help: 'Only counts a query if every competing page sits under this path.' },
    { key: 'country', label: 'Country or region (optional)', type: 'text', placeholder: 'All countries', datalist: COUNTRIES, half: true, help: 'Only counts clicks and impressions from this country.' },
    { key: 'depth', label: 'Position relevance (optional)', type: 'chips', default: '20', options: [['10', 'Top 10'], ['20', 'Top 20'], ['50', 'Top 50'], ['none', 'No limit']], help: 'Ignores competing pages that rank deeper than this, since a fight buried a few pages down rarely matters. Defaults to the top 20.' },
    { key: 'depthExact', label: 'or exactly (position)', type: 'number', placeholder: 'e.g. 15', min: 1, max: 200, step: 0.5, help: 'Optional. If you enter a number, it replaces the choice above.' },
    { key: 'range', label: 'Months to analyze', type: 'chips', default: '12', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['16', '16 months']], help: 'At least 6 months is recommended so the month-to-month swap check has enough history to be reliable. Search Console holds about 16 months at most.' },
    { key: 'rowCap', label: 'Max query + page rows per month', type: 'select', default: '25000', advanced: true, options: [['25000', '25,000 (default)'], ['50000', '50,000'], ['100000', '100,000']], help: 'Search Console returns the highest-click rows first; this caps how deep we go per month.' },
  ],

  async run({ source, settings, anchor, log }) {
    const range = Number(settings.range);
    const from = monthStart(addMonths(anchor, -(range - 1)));
    const to = monthEnd(anchor);
    const country = settings.country ? toCountryCode(settings.country) : '';
    const rows = await source.get({ dims: ['query', 'page'], from, to, byMonth: true, filters: { country }, rowCap: Number(settings.rowCap), onProgress: log });
    if (!rows.length) throw new Error('No query and page data found for that period.');
    const maxPosition = settings.depthExact != null ? settings.depthExact : settings.depth === 'none' ? null : Number(settings.depth);
    const res = runCannibalization(rows, {
      anchorMonth: anchor,
      range,
      keywords: settings.scope === 'keywords' ? settings.keywords : [],
      folder: settings.folder,
      maxPosition,
      brandTerms: settings.brand,
    });
    return { ...res, truncated: !!rows.truncated, anchor, range };
  },

  render(res, ctx) {
    const s = res.summary;
    const box = h('div');
    if (res.truncated) box.append(notice('warn', 'The row limit was reached for at least one month, so low-traffic queries may be missing. Raise the limit under Advanced options.'));
    if (!res.hasMonths) box.append(notice('warn', 'This data has no dates, so ranking swaps between months could not be checked. Priorities use position gaps and click shares only.'));
    box.append(
      statCards([
        { label: 'Queries analyzed', value: fmtInt(s.queriesAnalysed) },
        { label: 'Conflicts', value: fmtInt(s.conflicts), tone: s.conflicts ? 'bad' : '' },
        { label: 'Clicks involved', value: fmtInt(s.clicksInvolved) },
        { label: 'High', value: fmtInt(s.high), tone: s.high ? 'bad' : '' },
        { label: 'Medium', value: fmtInt(s.medium) },
        { label: 'Low', value: fmtInt(s.low) },
      ]),
    );
    const cols = (lowTraffic) => [
      { key: 'query', label: 'Query', value: (r) => r.query },
      { key: 'priority', label: 'Priority', render: (r) => priorityChip(r.priority), value: (r) => r.priority, sortValue: (r) => ({ high: 3, medium: 2, low: 1 })[r.priority] },
      { key: 'pageCount', label: 'Pages', num: true, value: (r) => r.pageCount },
      { key: 'totalClicks', label: 'Clicks', num: true, render: (r) => fmtInt(r.totalClicks), value: (r) => r.totalClicks },
      { key: 'totalImpressions', label: 'Impressions', num: true, render: (r) => fmtInt(r.totalImpressions), value: (r) => r.totalImpressions },
      { key: 'bestPosition', label: 'Best position', num: true, render: (r) => fmtPos(r.bestPosition), value: (r) => (r.bestPosition == null ? '' : Number(r.bestPosition.toFixed(1))) },
      { key: 'swaps', label: 'Leader swaps', num: true, render: (r) => (res.hasMonths ? (r.swapIndicator ? chip(`↔ ${r.swaps} of ${r.transitions}`, r.priority === 'high' ? 'high' : 'info') : '–') : ''), value: (r) => r.swaps },
      { key: 'leader', label: lowTraffic ? 'Most visible page' : 'Likely owner', className: 'url', render: (r) => pageLink(r.leader, shortUrl(r.leader, 50)), value: (r) => r.leader },
    ];
    const table = (rows, name, lowTraffic) =>
      dataTable({
        columns: cols(lowTraffic),
        rows,
        defaultSort: lowTraffic ? { key: 'totalImpressions', dir: 'desc' } : { key: 'priority', dir: 'desc' },
        filter: { get: (r) => r.priority, options: [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }] },
        search: { placeholder: 'Search queries…', text: (r) => r.query },
        csvName: name,
        expand: (r) => detail({ ...r, hasMonths: res.hasMonths }, ctx),
        pageSize: 40,
        empty: 'No cannibalization found with these settings.',
      });
    box.append(table(res.main, `keyword-cannibalization-${res.anchor}.csv`, false));
    if (res.low.length) {
      box.append(
        h('details', { class: 'rules', style: { marginTop: '18px' } },
          h('summary', null, `Low-traffic queries (${fmtInt(res.low.length)}): measured by impressions, fewer than ${fmtInt(Math.ceil(s.lowFloor))} clicks in total`),
          table(res.low, `keyword-cannibalization-low-traffic-${res.anchor}.csv`, true)),
      );
    }
    return box;
  },
};
