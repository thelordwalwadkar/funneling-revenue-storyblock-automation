import { chip, dataTable, notice, pageLink, priorityChip, statCards } from '../core/ui.js';
import { addMonths, fmtInt, fmtPos, h, inFolder, monthEnd, monthStart, normalizeFolder, shortUrl } from '../core/util.js';
import { RULES, runLinkGap } from '../engines/linkgap.js';

const ADVICE = {
  high: 'This page already earns search impressions but nothing on your site points to it. Add contextual links from the pages listed below (or from any page that discusses the topic), using the phrase people search for as the anchor.',
  medium: 'Only a link or two lead here. Add a few more from related pages so Google, and your visitors, can find it.',
  low: 'Reasonably linked, but still within easy reach of page one. One or two extra links with the right anchor text can help.',
};
const BATCH = 8;

export const tool = {
  slug: 'internal-link-gap',
  title: 'Internal Link Gap',
  gated: true,
  runLabel: 'Run Internal Link Gap',
  blurb: 'Find pages that earn search impressions but are barely linked to from the rest of your site, and see exactly where a link could go.',
  needs: { page: true, query: true },
  rules: [
    'We read your busiest pages (by search impressions) from the live site and note every link inside the page content. Menu, header, footer and sidebar links are ignored because they repeat on every page and say nothing about topic.',
    'Inbound links = how many other pages we read link to the page. This is counted from the pages we read, so it is a floor, not a full crawl. The homepage is skipped, because your logo and menu already reach it from every page.',
    `A page is checked when it has at least ${RULES.minImpressions} impressions. High priority: no inbound links and impressions at or above the typical (median) page. Medium: no inbound links but fewer impressions, or one inbound link with impressions at or above the median. Low: one inbound link with fewer impressions, or two while the page sits at positions ${RULES.nearPageOne[0]} to ${RULES.nearPageOne[1]}.`,
    `Link suggestions: for each page that needs links, take its ${RULES.topQueries} biggest search phrases. A page we read that already contains the exact phrase, and does not link there yet, is an easy place to add a link with that phrase as the anchor. If no page has the exact phrase, pages containing every word of it are offered as partial matches.`,
    'Brand terms you list are never used as anchors.',
  ],
  settings: [
    { key: 'range', label: 'Months of search data', type: 'chips', default: '3', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']], help: 'Used to find which pages and phrases matter. Recent months are usually enough.' },
    { key: 'maxPages', label: 'How many pages to read', type: 'chips', default: '100', options: [['50', '50 pages'], ['100', '100 pages'], ['150', '150 pages']], help: 'The busiest pages are read first. More pages find more link opportunities but take longer (about a second per page).' },
    { key: 'brand', label: 'Brand terms to exclude', type: 'tags', placeholder: 'e.g. yourbrand, your brand name', help: 'Comma separated. Brand phrases make poor anchor text.' },
    { key: 'folder', label: 'Limit to a folder (optional)', type: 'text', placeholder: 'e.g. /blog/', help: 'Only check pages under this path. Pages outside it are still read when they are among the busiest.' },
  ],

  async run({ source, settings, anchor, log, reportApi }) {
    const n = Number(settings.range);
    const from = monthStart(addMonths(anchor, -(n - 1)));
    const to = monthEnd(anchor);
    const pages = await source.get({ dims: ['page'], from, to, rowCap: 50000, onProgress: log });
    if (!pages.length) throw new Error('No page data found for that period.');
    const queryPages = await source.get({ dims: ['query', 'page'], from, to, filters: { pathPrefix: settings.folder }, rowCap: 100000, onProgress: log });

    const max = Number(settings.maxPages);
    const urls = [...pages].sort((a, b) => b.impressions - a.impressions).slice(0, max).map((r) => r.page);
    const batches = [];
    for (let i = 0; i < urls.length; i += BATCH) batches.push(urls.slice(i, i + BATCH));
    const crawl = [];
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const mine = batches[next++];
        const got = await reportApi.pages(mine);
        crawl.push(...got);
        done += mine.length;
        log(`Reading your pages… ${done} of ${urls.length}`);
      }
    };
    await Promise.all([worker(), worker()]);
    if (!crawl.some((c) => c.status >= 200 && c.status < 300)) throw new Error('We could not read any of your pages. Check that the site is reachable and does not block automated visitors.');

    log('Finding link gaps…');
    const folder = normalizeFolder(settings.folder);
    const inFolderPages = folder ? pages.filter((p) => inFolder(p.page, folder)) : pages;
    const res = runLinkGap({ pages: inFolderPages, queryPages, crawl, brandTerms: settings.brand });
    const thin = crawl.filter((c) => c.status >= 200 && c.status < 300 && (c.textLength ?? 0) < 200).length;
    return { ...res, thin, truncated: !!(pages.truncated || queryPages.truncated), range: n, anchor, requested: urls.length };
  },

  render(res) {
    const s = res.summary;
    const box = h('div');
    if (res.truncated) box.append(notice('warn', 'The row limit was reached, so low-traffic pages and phrases may be missing.'));
    if (s.crawled && res.thin / s.crawled > 0.5) box.append(notice('warn', 'Most pages returned very little text. If your site builds its pages in the browser (JavaScript), the links and phrases we can see are limited, so treat this as a partial picture.'));
    if (s.failed) box.append(notice('info', `${fmtInt(s.failed)} of ${fmtInt(res.requested)} pages could not be read (blocked, removed or slow). They are listed at the bottom.`));
    box.append(
      statCards([
        { label: 'Pages checked', value: fmtInt(s.pagesChecked), hint: `${fmtInt(s.crawled)} read from your site` },
        { label: 'Need links', value: fmtInt(s.underLinked), tone: s.underLinked ? 'bad' : 'good' },
        { label: 'High priority', value: fmtInt(s.high), tone: s.high ? 'bad' : '', hint: 'no links in, real demand' },
        { label: 'Medium', value: fmtInt(s.medium) },
        { label: 'Low', value: fmtInt(s.low) },
        { label: 'Link suggestions', value: fmtInt(s.suggestions), hint: 'where to add them' },
      ]),
    );

    const bySuggest = new Map();
    for (const g of res.suggestions) {
      if (!bySuggest.has(g.target)) bySuggest.set(g.target, []);
      bySuggest.get(g.target).push(g);
    }
    const matchChip = (m) => chip(m === 'exact' ? 'Exact phrase' : 'Partial match', m === 'exact' ? 'ok' : 'muted');

    box.append(h('h3', null, 'Pages that need more internal links'));
    box.append(
      dataTable({
        columns: [
          { key: 'page', label: 'Page', className: 'url', render: (r) => pageLink(r.page, shortUrl(r.page, 70)), value: (r) => r.page },
          { key: 'priority', label: 'Priority', render: (r) => priorityChip(r.priority), value: (r) => r.priority, sortValue: (r) => ({ high: 3, medium: 2, low: 1 })[r.priority] },
          { key: 'inbound', label: 'Links in', num: true, render: (r) => fmtInt(r.inbound), value: (r) => r.inbound },
          { key: 'impressions', label: 'Impressions', num: true, render: (r) => fmtInt(r.impressions), value: (r) => r.impressions },
          { key: 'clicks', label: 'Clicks', num: true, render: (r) => fmtInt(r.clicks), value: (r) => r.clicks },
          { key: 'position', label: 'Avg position', num: true, render: (r) => fmtPos(r.position), value: (r) => (r.position == null ? '' : Number(r.position.toFixed(1))) },
          { key: 'suggestions', label: 'Suggestions', num: true, render: (r) => fmtInt(r.suggestions || 0), value: (r) => r.suggestions || 0 },
        ],
        rows: res.gaps,
        defaultSort: { key: 'priority', dir: 'desc' },
        filter: { get: (r) => r.priority, options: [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }] },
        search: { placeholder: 'Search pages…', text: (r) => r.page },
        csvName: `internal-link-gap-${res.anchor}.csv`,
        expand: (r) => {
          const sug = bySuggest.get(r.page) || [];
          return h('div', null,
            h('p', null, h('strong', null, 'What to do: '), ADVICE[r.priority]),
            r.linkedFrom.length ? h('p', { class: 'small muted' }, `Already linked from: ${r.linkedFrom.slice(0, 5).join(', ')}`) : h('p', { class: 'small muted' }, 'No page we read links to this page inside its content.'),
            sug.length
              ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
                  h('thead', null, h('tr', null, ['Add a link on', 'Anchor text', 'Match'].map((t) => h('th', null, t)))),
                  h('tbody', null, sug.map((x) => h('tr', null, h('td', { class: 'url' }, pageLink(x.source, shortUrl(x.source, 80))), h('td', null, x.anchor), h('td', null, matchChip(x.match)))))))
              : h('p', { class: 'small muted' }, 'No page we read mentions this page’s main phrases yet, so there is no ready-made spot. Write a short mention or a related-reading block on a related page.'),
          );
        },
        pageSize: 40,
        empty: 'No pages need more links with these settings.',
      }),
    );

    if (res.suggestions.length) {
      box.append(
        h('h3', null, `Where to add the links (${fmtInt(res.suggestions.length)})`),
        dataTable({
          columns: [
            { key: 'target', label: 'Link to this page', className: 'url', render: (r) => pageLink(r.target, shortUrl(r.target, 60)), value: (r) => r.target },
            { key: 'targetPriority', label: 'Priority', render: (r) => priorityChip(r.targetPriority), value: (r) => r.targetPriority, sortValue: (r) => ({ high: 3, medium: 2, low: 1 })[r.targetPriority] },
            { key: 'source', label: 'From this page', className: 'url', render: (r) => pageLink(r.source, shortUrl(r.source, 60)), value: (r) => r.source },
            { key: 'anchor', label: 'Anchor text', value: (r) => r.anchor },
            { key: 'match', label: 'Match', render: (r) => matchChip(r.match), value: (r) => r.match },
            { key: 'queryImpressions', label: 'Phrase impressions', num: true, render: (r) => fmtInt(r.queryImpressions), value: (r) => r.queryImpressions },
          ],
          rows: res.suggestions,
          defaultSort: { key: 'targetPriority', dir: 'desc' },
          search: { placeholder: 'Search suggestions…', text: (r) => `${r.target} ${r.source} ${r.anchor}` },
          csvName: `internal-link-suggestions-${res.anchor}.csv`,
          pageSize: 40,
        }),
      );
    }

    if (res.failed.length) {
      box.append(
        h('details', { class: 'rules', style: { marginTop: '18px' } }, h('summary', null, `Pages we could not read (${fmtInt(res.failed.length)})`),
          h('ul', null, res.failed.slice(0, 40).map((f) => h('li', null, `${shortUrl(f.url, 80)} — ${f.status ? `HTTP ${f.status}` : f.error || 'could not be fetched'}`)))),
      );
    }
    return box;
  },
};
