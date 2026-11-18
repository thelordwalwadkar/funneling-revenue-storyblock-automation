// A "source" answers one question for every tool: give me rows for these dimensions over this date range.
//
//   source.get({ dims, from, to, byMonth, filters:{country, pathPrefix}, rowCap, onProgress }) -> rows
//
// MemorySource serves CSV uploads and demo data from memory; GscSource serves the live Search Console API.
// Tools never need to know which one they are talking to.
import { matchCountry } from './countries.js';
import { describeRows } from './csv.js';
import { queryAll } from './gsc.js';
import { Agg, addMonths, inFolder, lastCompletedMonth, monthEnd, monthKey, monthStart, monthsBetween, normalizeFolder } from './util.js';

const KEY_SEP = '\u0001';

export class MemorySource {
  constructor(rows, { kind = 'csv', label = 'Uploaded data', today = new Date() } = {}) {
    this.kind = kind;
    this.label = label;
    this.rows = rows;
    this.today = today;
    this.info = describeRows(rows);
  }

  capabilities() {
    return this.info;
  }

  months() {
    return this.info.minMonth ? monthsBetween(this.info.minMonth, this.info.maxMonth) : [];
  }

  /** Latest complete month in the data (a partial current month is never the anchor). */
  defaultAnchor() {
    const cur = monthKey(this.today);
    const max = this.info.maxMonth;
    if (!max) return lastCompletedMonth(this.today);
    return max >= cur ? addMonths(cur, -1) : max;
  }

  async get({ dims = [], from, to, byMonth = false, filters = {} } = {}) {
    const folder = normalizeFolder(filters.pathPrefix);
    const timed = this.info.time !== null;
    const fromM = from ? from.slice(0, 7) : null;
    const toM = to ? to.slice(0, 7) : null;
    const groups = new Map();
    for (const r of this.rows) {
      if (timed && (from || to)) {
        if (!r.month) continue;
        if (r.date) {
          if ((from && r.date < from) || (to && r.date > to)) continue;
        } else if ((fromM && r.month < fromM) || (toM && r.month > toM)) continue;
      }
      if (filters.country && !matchCountry(r.country, filters.country)) continue;
      if (folder && !inFolder(r.page || '', folder)) continue;
      const parts = dims.map((d) => (d === 'date' ? r.date || r.month || '' : r[d] ?? ''));
      if (byMonth) parts.push(r.month || '');
      const key = parts.join(KEY_SEP);
      let g = groups.get(key);
      if (!g) {
        g = { agg: new Agg(), first: r };
        groups.set(key, g);
      }
      g.agg.add(r);
    }
    const out = [];
    for (const g of groups.values()) {
      const row = { clicks: g.agg.clicks, impressions: g.agg.impressions, position: g.agg.position };
      for (const d of dims) {
        if (d === 'date') {
          row.date = g.first.date || null;
          row.month = g.first.month || null;
        } else row[d] = g.first[d] ?? '';
      }
      if (byMonth) row.month = g.first.month;
      out.push(row);
    }
    return out;
  }
}

export class GscSource {
  constructor({ siteUrl, today = new Date() }) {
    this.kind = 'gsc';
    this.siteUrl = siteUrl;
    this.label = siteUrl;
    this.today = today;
  }

  capabilities() {
    return { query: true, page: true, country: true, device: true, time: 'date', minMonth: null, maxMonth: null };
  }

  months() {
    const last = lastCompletedMonth(this.today);
    return monthsBetween(addMonths(last, -15), last);
  }

  defaultAnchor() {
    return lastCompletedMonth(this.today);
  }

  async get({ dims = [], from, to, byMonth = false, filters = {}, rowCap = 25000, onProgress } = {}) {
    const apiFilters = [];
    const folder = normalizeFolder(filters.pathPrefix);
    if (folder) apiFilters.push({ dimension: 'page', operator: 'contains', expression: folder });
    if (filters.country) apiFilters.push({ dimension: 'country', operator: 'equals', expression: filters.country.toLowerCase() });

    const windows = byMonth
      ? monthsBetween(monthKey(from), monthKey(to)).map((m) => ({
          month: m,
          start: m === monthKey(from) ? from : monthStart(m),
          end: m === monthKey(to) ? to : monthEnd(m),
        }))
      : [{ month: null, start: from, end: to }];

    const all = [];
    let truncated = false;
    for (const w of windows) {
      const label = w.month || `${from} → ${to}`;
      const rows = await queryAll({
        siteUrl: this.siteUrl,
        startDate: w.start,
        endDate: w.end,
        dimensions: dims,
        filters: apiFilters,
        rowCap,
        onPage: (n) => onProgress?.(`Fetching ${dims.join(' + ') || 'totals'} for ${label}… ${n.toLocaleString('en-US')} rows`),
      });
      if (rows.truncated) truncated = true;
      for (const r of rows) {
        if (w.month) r.month = w.month;
        if (folder && r.page && !inFolder(r.page, folder)) continue;
        all.push(r);
      }
    }
    all.truncated = truncated;
    return all;
  }
}
