// CSV import for Search Console exports (and Looker Studio / Search Analytics for Sheets exports).
// Tolerant on purpose: header names, delimiters and date formats vary a lot between exports.
import { monthKey, pad2, parseMonthName } from './util.js';

/** Minimal RFC 4180 parser with delimiter detection. Returns { rows: string[][], delimiter }. */
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((v) => v.trim() !== '')), delimiter };
}

function detectDelimiter(text) {
  const head = text.slice(0, 5000).split('\n')[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const c of head) {
    if (c === '"') q = !q;
    else if (!q && c in counts) counts[c]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const SYNONYMS = {
  query: ['query', 'queries', 'topqueries', 'searchquery', 'searchqueries', 'keyword', 'keywords', 'searchterm', 'term'],
  page: ['page', 'pages', 'toppages', 'landingpage', 'landingpages', 'landingpageurl', 'url', 'pageurl', 'address', 'urldata'],
  date: ['date', 'day', 'month', 'dateyearmonth', 'period', 'yearmonth', 'monthyear', 'datemonth'],
  country: ['country', 'countrycode', 'countries'],
  device: ['device', 'devices', 'devicecategory'],
  clicks: ['clicks', 'click', 'webclicks'],
  impressions: ['impressions', 'impression', 'impr', 'webimpressions'],
  ctr: ['ctr', 'clickthroughrate', 'urlctr', 'sitectr'],
  position: ['position', 'avgposition', 'averageposition', 'avgpos', 'averagepos', 'avgrank', 'urlposition'],
};

export function mapHeaders(headers) {
  const map = {};
  const used = new Set();
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(SYNONYMS)) {
      if (!(field in map) && names.includes(n)) {
        map[field] = i;
        used.add(i);
        return;
      }
    }
  });
  return { map, unmapped: headers.filter((_, i) => !used.has(i)) };
}

/** Parse the many ways a date or month appears. Returns { date?, month } or null. */
export function parseDateLike(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s))) return { date: `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`, month: `${m[1]}-${pad2(+m[2])}` };
  if ((m = /^(\d{4})[-/](\d{1,2})$/.exec(s))) return { month: `${m[1]}-${pad2(+m[2])}` };
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return { date: `${m[1]}-${m[2]}-${m[3]}`, month: `${m[1]}-${m[2]}` };
  // "Dec 2024", "December 2024", "Feb-25", "Feb 25", "Sep'25"
  if ((m = /^([A-Za-z]{3,9})\.?[\s\-/,']*(\d{2}|\d{4})$/.exec(s))) {
    const mo = parseMonthName(m[1]);
    if (mo) return { month: `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${pad2(mo)}` };
  }
  // "2024 Dec"
  if ((m = /^(\d{4})[\s\-/,]+([A-Za-z]{3,9})$/.exec(s))) {
    const mo = parseMonthName(m[2]);
    if (mo) return { month: `${m[1]}-${pad2(mo)}` };
  }
  // 31/12/2025 or 12/31/2025 — day-first only when the first number can't be a month
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) {
    const a = +m[1];
    const b = +m[2];
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { date: `${m[3]}-${pad2(mo)}-${pad2(d)}`, month: `${m[3]}-${pad2(mo)}` };
  }
  // "Dec 5, 2025", "5 Dec 2025"
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    const mo = parseMonthName(m[1]);
    if (mo) return { date: `${m[3]}-${pad2(mo)}-${pad2(+m[2])}`, month: `${m[3]}-${pad2(mo)}` };
  }
  if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s))) {
    const mo = parseMonthName(m[2]);
    if (mo) return { date: `${m[3]}-${pad2(mo)}-${pad2(+m[1])}`, month: `${m[3]}-${pad2(mo)}` };
  }
  return null;
}

/** Guess the month a monthly export covers from its file name ("2025-03", "Mar 2025", "2025_3_mar"). */
export function guessMonthFromName(name) {
  const base = String(name).replace(/\.[a-z0-9]+$/i, '');
  let m = /(20\d{2})[-_. ]?(0[1-9]|1[0-2])(?!\d)/.exec(base);
  if (m) return `${m[1]}-${m[2]}`;
  m = /([A-Za-z]{3,9})[-_. ]*'?(20\d{2}|\d{2})(?!\d)/.exec(base);
  if (m) {
    const mo = parseMonthName(m[1]);
    if (mo) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${pad2(mo)}`;
  }
  m = /(20\d{2})[-_. ]+(\d{1,2})[-_. ]+([A-Za-z]{3})/.exec(base);
  if (m) return `${m[1]}-${pad2(+m[2])}`;
  return null;
}

function toNumber(v, decimalComma) {
  if (v == null) return NaN;
  let s = String(v).trim().replace(/%$/, '').replace(/\s/g, '');
  if (s === '' || s === '-') return NaN;
  if (decimalComma && /^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  return parseFloat(s);
}

/**
 * Turn CSV text into canonical rows.
 * @param {string} text
 * @param {{ assumeMonth?: string|null }} opts  month to stamp on rows when the file has no date column
 */
export function importCSV(text, { assumeMonth = null } = {}) {
  const { rows: grid, delimiter } = parseCSV(text);
  if (grid.length < 2) return { rows: [], meta: { error: 'The file has no data rows.' } };
  const headers = grid[0].map((h) => h.trim());
  const { map, unmapped } = mapHeaders(headers);
  if (!('clicks' in map) && !('impressions' in map)) {
    return { rows: [], meta: { error: 'No Clicks or Impressions column found. Expected headers like Query, Page, Date, Clicks, Impressions, CTR, Position.', headers } };
  }
  const decimalComma = delimiter === ';';
  const out = [];
  let skipped = 0;
  let badDates = 0;
  let hasDate = false;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const clicks = toNumber(r[map.clicks], decimalComma);
    let impressions = toNumber(r[map.impressions], decimalComma);
    const ctr = toNumber(r[map.ctr], decimalComma);
    if (!Number.isFinite(impressions) && Number.isFinite(clicks) && Number.isFinite(ctr) && ctr > 0) impressions = Math.round(clicks / (ctr > 1 ? ctr / 100 : ctr));
    if (!Number.isFinite(clicks) && !Number.isFinite(impressions)) {
      skipped++;
      continue;
    }
    const row = { clicks: Number.isFinite(clicks) ? clicks : 0, impressions: Number.isFinite(impressions) ? impressions : 0 };
    const pos = toNumber(r[map.position], decimalComma);
    row.position = Number.isFinite(pos) && pos > 0 ? pos : null;
    if ('query' in map) row.query = (r[map.query] ?? '').trim();
    if ('page' in map) row.page = (r[map.page] ?? '').trim();
    if ('country' in map) row.country = (r[map.country] ?? '').trim();
    if ('device' in map) row.device = (r[map.device] ?? '').trim().toLowerCase();
    if ('date' in map) {
      const d = parseDateLike(r[map.date]);
      if (d) {
        hasDate = true;
        row.month = d.month;
        if (d.date) row.date = d.date;
      } else badDates++;
    }
    if (!row.month && assumeMonth) row.month = assumeMonth;
    out.push(row);
  }
  return {
    rows: out,
    meta: {
      headers,
      unmapped,
      delimiter,
      count: out.length,
      skipped,
      badDates,
      hasQuery: 'query' in map,
      hasPage: 'page' in map,
      hasDateColumn: 'date' in map,
      hasDate,
      hasCountry: 'country' in map,
      hasDevice: 'device' in map,
      hasPosition: 'position' in map,
      monthFromName: !hasDate ? assumeMonth : null,
    },
  };
}

/** What a loaded dataset can answer. `time` is 'date' (daily), 'month' (monthly) or null. */
export function describeRows(rows) {
  let query = false, page = false, country = false, device = false, date = false, month = false;
  let minMonth = null, maxMonth = null;
  for (const r of rows) {
    if (r.query) query = true;
    if (r.page) page = true;
    if (r.country) country = true;
    if (r.device) device = true;
    if (r.date) date = true;
    if (r.month) {
      month = true;
      if (!minMonth || r.month < minMonth) minMonth = r.month;
      if (!maxMonth || r.month > maxMonth) maxMonth = r.month;
    }
  }
  return { query, page, country, device, time: date ? 'date' : month ? 'month' : null, minMonth, maxMonth, rows: rows.length };
}

export { monthKey };
