import { chip, dataTable, notice, pageLink, statCards } from '../core/ui.js';
import { addMonths, fmtInt, fmtPct, fmtPos, h, inFolder, monthEnd, monthStart, normalizeFolder, shortUrl } from '../core/util.js';
import { REASON, REASON_ACTION, REASON_LABEL, RULES, runIndexBloat } from '../engines/indexbloat.js';

const TONE = { params: 'high', duplicate: 'high', pattern: 'medium', barely: 'muted' };
const INSPECT_LIMIT = 25;

function inspectChip(r) {
  if (!r) return h('span', { class: 'muted' }, '–');
  if (r.error) return chip('Could not check', 'muted');
  if (r.verdict === 'PASS') return h('span', { title: r.coverage }, chip('In Google', 'high'));
  if (r.verdict === 'NEUTRAL') return h('span', { title: r.coverage }, chip(r.coverage ? `Not indexed: ${r.coverage}` : 'Not indexed', 'ok'));
  return h('span', { title: r.coverage }, chip(r.coverage || 'Problem', 'medium'));
}

export const tool = {
  slug: 'index-bloat',
  title: 'Index Bloat',
  gated: true,
  runLabel: 'Run Index Bloat',
  blurb: 'Find URLs that Google shows or you submit but that earn nothing, so crawl effort and authority are not spent on them.',
  needs: { page: true },
  rules: [
    'Search Console lists every URL that earned impressions in the period. Each one is checked, and gets the first reason that applies:',
    `${REASON_LABEL.params}: the address has a "?" query string (filters, sorting, tracking, sessions).`,
    `${REASON_LABEL.duplicate}: the same page under another address (http or https, www or not, trailing slash, index.html, capital letters). The version with the most clicks is kept as the main one.`,
    `${REASON_LABEL.pattern}: the path looks like a tag, category, author, "page 2", search, feed, print, cart or login archive.`,
    `${REASON_LABEL.barely}: at most ${RULES.barelySeenImpressions} impressions and no clicks in the period you chose.`,
    'If your sitemap can be read, URLs in it that never appeared in search are listed as "silent" (probably not indexed, or not wanted), and URLs that appear in search but are missing from it are listed as "unlisted".',
    `A folder is a bloat candidate when it holds ${RULES.folderUrlShare * 100}% or more of all URLs but ${RULES.folderClickShare * 100}% or less of all clicks (and has at least ${RULES.minFolderUrls} URLs).`,
    'Search Console cannot list every indexed URL, so this report estimates bloat from what Google shows. The optional check asks Google directly about the biggest flagged URLs.',
  ],
  settings: [
    { key: 'range', label: 'Months to analyze', type: 'chips', default: '12', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['16', '16 months']], help: 'A longer range stops seasonal pages from looking like they are never clicked.' },
    { key: 'sitemap', label: 'Compare with my sitemap', type: 'chips', default: 'yes', options: [['yes', 'Yes, read my sitemap'], ['no', 'Skip the sitemap']], help: 'We read the sitemap listed in your robots.txt (or /sitemap.xml) to find URLs that never appear in search.' },
    { key: 'folder', label: 'Limit to a folder (optional)', type: 'text', placeholder: 'e.g. /blog/', help: 'Analyze only URLs under a path. Leave empty for the whole property.' },
  ],

  async run({ source, settings, anchor, log, reportApi }) {
    const n = Number(settings.range);
    const from = monthStart(addMonths(anchor, -(n - 1)));
    const to = monthEnd(anchor);
    const rows = await source.get({ dims: ['page'], from, to, filters: { pathPrefix: settings.folder }, rowCap: 100000, onProgress: log });
    if (!rows.length) throw new Error('No page data found for that period.');
    let sitemapUrls = [];
    let sitemapNote = '';
    let sitemapTruncated = false;
    if (settings.sitemap === 'yes') {
      try {
        log('Reading your sitemap…');
        const sm = await reportApi.sitemap();
        sitemapUrls = sm.urls || [];
        sitemapTruncated = !!sm.truncated;
        if (!sitemapUrls.length) sitemapNote = 'We could not find a readable sitemap for this site, so the sitemap comparison was skipped.';
      } catch (e) {
        sitemapNote = `We could not read the sitemap (${e.message}), so the sitemap comparison was skipped.`;
      }
      const f = normalizeFolder(settings.folder);
      if (f) sitemapUrls = sitemapUrls.filter((u) => inFolder(u, f));
    }
    log('Checking every URL…');
    return { ...runIndexBloat(rows, { sitemapUrls }), sitemapNote, sitemapTruncated, truncated: !!rows.truncated, range: n, anchor };
  },

  render(res, ctx) {
    const s = res.summary;
    const box = h('div');
    if (res.truncated) box.append(notice('warn', 'The row limit was reached, so URLs with very few impressions may be missing.'));
    if (res.sitemapNote) box.append(notice('warn', res.sitemapNote));
    if (res.sitemapTruncated) box.append(notice('warn', 'The sitemap is very large, so only the first 5,000 URLs were compared.'));
    box.append(
      statCards([
        { label: 'URLs seen in search', value: fmtInt(s.urlsSeen), hint: `${fmtPct(s.earningShare, 0)} earn a click` },
        { label: 'Flagged as bloat', value: fmtInt(s.flagged), tone: s.flagged ? 'bad' : 'good', hint: 'shown, but low value' },
        ...(res.hasSitemap ? [{ label: 'Silent in sitemap', value: fmtInt(s.silent), tone: s.silent ? 'bad' : '', hint: 'listed, never shown' }, { label: 'Unlisted', value: fmtInt(s.unlisted), hint: 'shown, not in sitemap' }] : []),
        { label: 'Share of URLs wasted', value: fmtPct(s.bloatShare, 0), tone: s.bloatShare > 0.25 ? 'bad' : '', hint: 'flagged + silent' },
        { label: 'Bloated folders', value: fmtInt(s.candidateFolders), tone: s.candidateFolders ? 'bad' : '' },
      ]),
    );

    // ---- flagged URLs (with an optional "ask Google" step)
    const inspected = new Map();
    const holder = h('div');
    const paint = () =>
      holder.replaceChildren(
        dataTable({
          columns: [
            { key: 'page', label: 'URL', className: 'url', render: (r) => pageLink(r.page, shortUrl(r.page, 80)), value: (r) => r.page },
            { key: 'reason', label: 'Why flagged', render: (r) => chip(REASON_LABEL[r.reason], TONE[r.reason]), value: (r) => REASON_LABEL[r.reason] },
            { key: 'clicks', label: 'Clicks', num: true, render: (r) => fmtInt(r.clicks), value: (r) => r.clicks },
            { key: 'impressions', label: 'Impressions', num: true, render: (r) => fmtInt(r.impressions), value: (r) => r.impressions },
            { key: 'position', label: 'Avg position', num: true, render: (r) => fmtPos(r.position), value: (r) => (r.position == null ? '' : Number(r.position.toFixed(1))) },
            ...(res.hasSitemap ? [{ key: 'unlisted', label: 'Sitemap', render: (r) => (r.unlisted ? chip('Not listed', 'muted') : chip('Listed', 'info')), value: (r) => (r.unlisted ? 'Not listed' : 'Listed') }] : []),
            ...(inspected.size ? [{ key: 'google', label: 'Google says', sortable: false, render: (r) => inspectChip(inspected.get(r.page)), value: (r) => { const g = inspected.get(r.page); return g ? g.coverage || g.verdict : ''; } }] : []),
          ],
          rows: res.flagged,
          defaultSort: { key: 'impressions', dir: 'desc' },
          filter: { get: (r) => r.reason, options: [REASON.PARAMS, REASON.DUPLICATE, REASON.PATTERN, REASON.BARELY].map((v) => ({ value: v, label: REASON_LABEL[v] })) },
          search: { placeholder: 'Search URLs…', text: (r) => r.page },
          csvName: `index-bloat-${res.anchor}.csv`,
          expand: (r) => h('div', null, h('strong', null, REASON_LABEL[r.reason]), ' — ', REASON_ACTION[r.reason], r.main ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Main version: ', pageLink(r.main, shortUrl(r.main, 90))) : null),
          pageSize: 40,
          empty: 'No flagged URLs.',
        }),
      );
    box.append(h('h3', null, `Flagged URLs (${fmtInt(res.flagged.length)})`));
    if (res.flagged.length && ctx.reportApi?.inspect) {
      const status = h('span', { class: 'small muted' }, `Asks Google about the ${Math.min(INSPECT_LIMIT, res.flagged.length)} flagged URLs with the most impressions.`);
      const btn = h('button', { type: 'button', class: 'btn secondary small', onclick: async () => {
        btn.disabled = true;
        const targets = [...res.flagged].sort((a, b) => b.impressions - a.impressions).slice(0, INSPECT_LIMIT);
        let done = 0;
        for (const t of targets) {
          status.textContent = `Asking Google… ${done} of ${targets.length}`;
          try {
            inspected.set(t.page, await ctx.reportApi.inspect(t.page));
          } catch (e) {
            inspected.set(t.page, { error: e.message });
            if (/expired|sign in/i.test(e.message)) break;
          }
          done++;
        }
        status.textContent = `Checked ${done} URLs. "In Google" means the URL is indexed, so it is confirmed bloat; "Not indexed" means Google is already ignoring it.`;
        paint();
      } }, `Check Google's index status for the top ${Math.min(INSPECT_LIMIT, res.flagged.length)}`);
      box.append(h('div', { class: 'btn-row', style: { margin: '8px 0' } }, btn, status));
    }
    paint();
    box.append(holder);

    // ---- sitemap comparison
    if (res.hasSitemap) {
      const list = (rows, cols, csv, empty) => dataTable({ columns: cols, rows, defaultSort: cols[1] ? { key: cols[1].key, dir: 'desc' } : undefined, search: { placeholder: 'Search URLs…', text: (r) => r.page }, csvName: csv, pageSize: 25, empty });
      const urlCol = { key: 'page', label: 'URL', className: 'url', render: (r) => pageLink(r.page, shortUrl(r.page, 90)), value: (r) => r.page };
      box.append(
        h('details', { class: 'rules', style: { marginTop: '20px' } }, h('summary', null, `In your sitemap, but never shown in search (${fmtInt(res.silent.length)})`),
          h('p', { class: 'small muted' }, 'These URLs earned no impressions in the period. Google is probably not indexing them, or not ranking them. If you do not need them, remove them from the sitemap; if you do, they need links and better content.'),
          list(res.silent, [urlCol], `index-bloat-silent-${res.anchor}.csv`, 'Every sitemap URL appeared in search.')),
        h('details', { class: 'rules', style: { marginTop: '10px' } }, h('summary', null, `Shown in search, but missing from your sitemap (${fmtInt(res.unlisted.length)})`),
          h('p', { class: 'small muted' }, 'Google found these URLs without you listing them. Add the ones you want to the sitemap; keep the rest out of the index.'),
          list(res.unlisted, [urlCol, { key: 'impressions', label: 'Impressions', num: true, render: (r) => fmtInt(r.impressions), value: (r) => r.impressions }, { key: 'clicks', label: 'Clicks', num: true, render: (r) => fmtInt(r.clicks), value: (r) => r.clicks }], `index-bloat-unlisted-${res.anchor}.csv`, 'Every URL in search is in your sitemap.')),
      );
    }

    // ---- folders
    box.append(
      h('h3', null, 'Folders: share of URLs against share of clicks'),
      dataTable({
        columns: [
          { key: 'folder', label: 'Folder', value: (f) => f.folder },
          { key: 'urls', label: 'URLs', num: true, render: (f) => fmtInt(f.urls), value: (f) => f.urls },
          { key: 'urlShare', label: 'Share of URLs', num: true, render: (f) => fmtPct(f.urlShare, 0), value: (f) => Number(f.urlShare.toFixed(4)) },
          { key: 'clicks', label: 'Clicks', num: true, render: (f) => fmtInt(f.clicks), value: (f) => f.clicks },
          { key: 'clickShare', label: 'Share of clicks', num: true, render: (f) => fmtPct(f.clickShare, 0), value: (f) => Number(f.clickShare.toFixed(4)) },
          { key: 'earning', label: 'URLs with a click', num: true, render: (f) => fmtInt(f.earning), value: (f) => f.earning },
          { key: 'candidate', label: 'Verdict', render: (f) => (f.candidate ? chip('Bloat candidate', 'high') : chip('OK', 'ok')), value: (f) => (f.candidate ? 'Bloat candidate' : 'OK') },
        ],
        rows: res.folders,
        defaultSort: { key: 'urls', dir: 'desc' },
        csvName: `index-bloat-folders-${res.anchor}.csv`,
        pageSize: 25,
        empty: 'No folders.',
      }),
    );
    return box;
  },
};
