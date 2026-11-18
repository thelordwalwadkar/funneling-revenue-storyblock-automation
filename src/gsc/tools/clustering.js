import { chip, dataTable, notice, pageLink, statCards } from '../core/ui.js';
import { addMonths, fmtInt, fmtPct, fmtPos, h, monthEnd, monthStart, shortUrl } from '../core/util.js';
import { RULES, VERDICT, VERDICT_ACTION, VERDICT_LABEL, runClustering } from '../engines/clustering.js';

const TONE = { split: 'high', stuck: 'medium', owned: 'ok', mixed: 'muted' };
const verdictChip = (v) => chip(VERDICT_LABEL[v], TONE[v]);

function detail(c) {
  return h('div', null,
    h('p', null, h('strong', null, VERDICT_LABEL[c.verdict]), ' — ', VERDICT_ACTION[c.verdict]),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, ['Query in this topic', 'Clicks', 'Impressions', 'Avg position'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
      h('tbody', null, c.members.slice(0, 25).map((m) => h('tr', null, h('td', null, m.query), h('td', { class: 'num' }, fmtInt(m.clicks)), h('td', { class: 'num' }, fmtInt(m.impressions)), h('td', { class: 'num' }, fmtPos(m.position))))))),
    c.members.length > 25 ? h('p', { class: 'small muted' }, `Showing the 25 biggest of ${fmtInt(c.members.length)} queries. The CSV has them all.`) : null,
    h('h3', null, 'Pages ranking for this topic'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, ['Page', 'Share of topic', 'Clicks', 'Impressions', 'Avg position'].map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))),
      h('tbody', null, c.pages.slice(0, 8).map((p) => h('tr', null,
        h('td', { class: 'url' }, pageLink(p.page, shortUrl(p.page, 80))),
        h('td', null, h('div', { class: 'bar', title: fmtPct(p.share, 0) }, h('i', { style: { width: `${Math.round(p.share * 100)}%` } })), fmtPct(p.share, 0)),
        h('td', { class: 'num' }, fmtInt(p.clicks)), h('td', { class: 'num' }, fmtInt(p.impressions)), h('td', { class: 'num' }, fmtPos(p.position))))))),
  );
}

export const tool = {
  slug: 'query-clustering',
  title: 'Query Clustering',
  gated: true,
  runLabel: 'Run Query Clustering',
  blurb: 'Group the queries people use into topics, so each topic is planned, written and judged as one thing.',
  needs: { query: true, page: true },
  rules: [
    'Queries are compared after dropping filler words and folding plurals, so "pump", "pumps" and "pump" in a different order read as the same words.',
    'Queries using the same words in any order always join one topic.',
    `Two queries also join when the same page earns at least ${RULES.pageShare * 100}% of the impressions of both of them and they share enough words (an overlap of ${RULES.jaccard} or more, or one fully contained in the other with 2+ words). "The same page ranks for both" is the stand-in for "Google treats these as the same question".`,
    `Split across pages: two or more pages each hold ${RULES.splitShare * 100}% or more of a topic's impressions.`,
    `Stuck beyond page one: the topic's average position is worse than ${RULES.page1} and it is bigger than the typical topic.`,
    `One page owns it: a single page holds ${RULES.ownerShare * 100}% or more of the topic's impressions. Everything else is Mixed.`,
    `Queries with fewer than ${RULES.minImpressions} impressions are left out, and so are brand terms you list.`,
  ],
  settings: [
    { key: 'range', label: 'Months to analyze', type: 'chips', default: '3', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['16', '16 months']], help: 'Longer ranges find more of the long tail but blend older behavior into the result.' },
    { key: 'brand', label: 'Brand terms to exclude', type: 'tags', placeholder: 'e.g. yourbrand, your brand name', help: 'Comma separated. Brand queries are one topic on their own and would crowd the list.' },
    { key: 'folder', label: 'Limit to a folder (optional)', type: 'text', placeholder: 'e.g. /blog/', help: 'Only queries answered by pages under this path.' },
    { key: 'minImpr', label: 'Ignore queries with fewer impressions than', type: 'number', default: RULES.minImpressions, min: 1, max: 1000, step: 1, advanced: true },
  ],

  async run({ source, settings, anchor, log }) {
    const n = Number(settings.range);
    const from = monthStart(addMonths(anchor, -(n - 1)));
    const to = monthEnd(anchor);
    const rows = await source.get({ dims: ['query', 'page'], from, to, filters: { pathPrefix: settings.folder }, rowCap: 100000, onProgress: log });
    if (!rows.length) throw new Error('No query and page data found for that period.');
    log('Grouping queries into topics…');
    const res = runClustering(rows, { brandTerms: settings.brand, minImpressions: settings.minImpr ?? RULES.minImpressions });
    return { ...res, truncated: !!rows.truncated, range: n, anchor };
  },

  render(res) {
    const s = res.summary;
    const box = h('div');
    if (res.truncated) box.append(notice('warn', 'The row limit was reached, so low-traffic queries may be missing from the topics.'));
    if (!res.clusters.length) {
      box.append(notice('info', 'No topics with two or more queries were found. Try more months, or lower the minimum impressions under Advanced options.'));
      return box;
    }
    box.append(
      statCards([
        { label: 'Queries analyzed', value: fmtInt(s.queriesAnalysed) },
        { label: 'Topics found', value: fmtInt(s.clusters), hint: `${fmtInt(s.queriesClustered)} queries grouped` },
        { label: 'Split across pages', value: fmtInt(s.counts.split), tone: s.counts.split ? 'bad' : '', hint: 'pages sharing a topic' },
        { label: 'Stuck beyond page one', value: fmtInt(s.counts.stuck), tone: s.counts.stuck ? 'bad' : '', hint: 'demand, weak rankings' },
        { label: 'One page owns it', value: fmtInt(s.counts.owned), tone: 'good' },
        { label: 'Stand-alone queries', value: fmtInt(s.standalone), hint: 'no close relatives' },
      ]),
    );
    box.append(
      dataTable({
        columns: [
          { key: 'head', label: 'Topic (biggest query)', value: (c) => c.head },
          { key: 'verdict', label: 'Verdict', render: (c) => verdictChip(c.verdict), value: (c) => VERDICT_LABEL[c.verdict] },
          { key: 'queryCount', label: 'Queries', num: true, value: (c) => c.queryCount },
          { key: 'clicks', label: 'Clicks', num: true, render: (c) => fmtInt(c.clicks), value: (c) => c.clicks },
          { key: 'impressions', label: 'Impressions', num: true, render: (c) => fmtInt(c.impressions), value: (c) => c.impressions },
          { key: 'position', label: 'Avg position', num: true, render: (c) => fmtPos(c.position), value: (c) => (c.position == null ? '' : Number(c.position.toFixed(1))) },
          { key: 'pageCount', label: 'Pages', num: true, value: (c) => c.pageCount },
          { key: 'topPage', label: 'Main page', className: 'url', render: (c) => pageLink(c.topPage, shortUrl(c.topPage, 50)), value: (c) => c.topPage },
          { key: 'members', label: 'All queries', hidden: true, value: (c) => c.members.map((m) => m.query).join(' | ') },
        ],
        rows: res.clusters,
        defaultSort: { key: 'impressions', dir: 'desc' },
        filter: { get: (c) => c.verdict, options: [VERDICT.SPLIT, VERDICT.STUCK, VERDICT.MIXED, VERDICT.OWNED].map((v) => ({ value: v, label: VERDICT_LABEL[v] })) },
        search: { placeholder: 'Search topics and queries…', text: (c) => `${c.head} ${c.members.map((m) => m.query).join(' ')}` },
        csvName: `query-clusters-${res.anchor}.csv`,
        expand: detail,
        pageSize: 40,
        empty: 'No topics match.',
      }),
    );
    return box;
  },
};
