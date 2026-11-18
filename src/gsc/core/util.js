// Shared helpers. Everything here is safe to import from Node (tests) as well as the browser:
// the DOM helpers only touch `document` when they are actually called.

// ---------- DOM ----------

/** Create an element. Children can be nodes or plain values; strings always become text nodes (never HTML). */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

// ---------- numbers & formatting ----------

export const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '–');
export const fmtNum = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
export const fmtPct = (n, d = 1) => (Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : '–');
export const fmtPos = (n) => (Number.isFinite(n) ? n.toFixed(1) : '–');
export const fmtSigned = (n, d = 0) => (Number.isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '–');
export const fmtSignedPct = (n, d = 0) => (Number.isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(d)}%` : '–');

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sum = (arr) => arr.reduce((a, b) => a + b, 0);
export const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);
export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Relative change (cur - prev) / prev. Returns null when there is no baseline. */
export const pctChange = (cur, prev) => (prev > 0 ? (cur - prev) / prev : null);

// ---------- dates (all UTC, ISO strings) ----------

export const pad2 = (n) => String(n).padStart(2, '0');

export function monthKey(d) {
  if (typeof d === 'string') return d.slice(0, 7);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}
export function monthsBetween(a, b) {
  const out = [];
  for (let k = a; k <= b; k = addMonths(k, 1)) out.push(k);
  return out;
}
export const monthStart = (k) => `${k}-01`;
export function monthEnd(k) {
  const [y, m] = k.split('-').map(Number);
  return `${k}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
export const lastCompletedMonth = (now = new Date()) => addMonths(monthKey(now), -1);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (k) => {
  const [y, m] = k.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};
export const isoDate = (d) => d.toISOString().slice(0, 10);
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
export function addYears(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return isoDate(d);
}
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const parseMonthName = (s) => {
  const i = MONTH_NAMES.findIndex((m) => s.slice(0, 3).toLowerCase() === m.toLowerCase());
  return i < 0 ? null : i + 1;
};

// ---------- aggregation ----------

/** Running totals with an impression-weighted average position (how Search Console itself averages). */
export class Agg {
  clicks = 0;
  impressions = 0;
  posW = 0;
  wsum = 0;
  add(r) {
    this.clicks += r.clicks || 0;
    this.impressions += r.impressions || 0;
    if (r.position > 0) {
      const w = r.impressions > 0 ? r.impressions : 1;
      this.posW += r.position * w;
      this.wsum += w;
    }
    return this;
  }
  get position() {
    return this.wsum ? this.posW / this.wsum : null;
  }
  get ctr() {
    return this.impressions ? this.clicks / this.impressions : 0;
  }
}

/** Group rows by a key function into Map<key, Agg>. */
export function groupAgg(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    let a = m.get(k);
    if (!a) m.set(k, (a = new Agg()));
    a.add(r);
  }
  return m;
}

// ---------- text / url helpers ----------

export function makeBrandMatcher(terms) {
  const list = (terms || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return () => false;
  return (q) => {
    const s = String(q || '').toLowerCase();
    return list.some((t) => s.includes(t));
  };
}
export function makeKeywordMatcher(terms) {
  const list = (terms || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return () => true;
  return (q) => {
    const s = String(q || '').toLowerCase();
    return list.some((t) => s.includes(t));
  };
}
export function pathOf(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return String(url || '');
  }
}
export function normalizeFolder(f) {
  let s = String(f || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) s = pathOf(s);
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}
export const inFolder = (url, folder) => !folder || pathOf(url).toLowerCase().startsWith(folder.toLowerCase());
export function shortUrl(url, max = 70) {
  let s = String(url || '');
  try {
    const u = new URL(s);
    s = u.pathname + u.search;
  } catch {
    /* keep as is */
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
export function splitTerms(str) {
  return String(str || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- files ----------

export function csvEscape(v) {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(v) : String(v);
  // Neutralise spreadsheet formula injection for text cells (queries come from the open web).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(columns, rows) {
  const head = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(c.value(r))).join(',')).join('\n');
  return `${head}\n${body}\n`;
}
export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
