// Small UI building blocks shared by every tool. Everything is built with textContent (never innerHTML):
// queries and URLs come from the open web and must never be interpreted as markup.
import { clear, downloadText, fmtInt, h, svg, toCSV } from './util.js';

export const chip = (text, tone = 'muted') => h('span', { class: `chip chip-${tone}` }, text);
export const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
export const priorityChip = (p) => chip(PRIORITY_LABEL[p] || p, p);

export function notice(kind, ...kids) {
  return h('div', { class: `notice ${kind === 'info' ? '' : kind}`.trim(), role: kind === 'error' ? 'alert' : null }, ...kids);
}

export function statCards(items) {
  return h(
    'div',
    { class: 'stats' },
    items.map((s) => h('div', { class: `stat ${s.tone || ''}`.trim() }, h('div', { class: 'k' }, s.label), h('div', { class: 'v' }, s.value), s.hint ? h('div', { class: 'h' }, s.hint) : null)),
  );
}

export function sparkline(values, { w = 96, h: hh = 26, stroke = 'var(--steel-600)' } = {}) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * (w - 2) + 1).toFixed(1)},${(hh - 2 - (v / max) * (hh - 4) + 1).toFixed(1)}`).join(' ');
  return svg('svg', { class: 'spark', width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, 'aria-hidden': 'true' }, svg('polyline', { points: pts, fill: 'none', stroke, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
}

export function pageLink(url, text) {
  if (/^https?:\/\//i.test(url)) return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: url }, text ?? url);
  return h('span', { title: url }, text ?? url);
}

export function deltaText(value, { good = 'up', d = 0, pct = true } = {}) {
  if (value == null || !Number.isFinite(value)) return h('span', { class: 'muted' }, '–');
  const up = value > 0;
  const isGood = good === 'up' ? up : !up;
  const num = pct ? Math.abs(value) * 100 : Math.abs(value);
  const body = pct && num >= 1000 ? '1,000%+' : `${num.toFixed(d)}${pct ? '%' : ''}`;
  if (Number(num.toFixed(d)) === 0) return h('span', { class: 'muted' }, body); // rounds to zero: no sign, no colour
  return h('span', { class: isGood ? 'delta-up' : 'delta-down' }, `${value > 0 ? '+' : '−'}${body}`);
}

/**
 * Sortable, filterable, paged table with CSV export and optional expandable rows.
 * columns: [{ key, label, num, value(row), sortValue(row), render(row), csv:false, hidden:true (CSV only), className }]
 */
export function dataTable({ columns: allColumns, rows, defaultSort, pageSize = 50, filter, search, csvName, expand, empty = 'Nothing to show.' }) {
  const columns = allColumns.filter((c) => !c.hidden); // hidden columns are not drawn but still go into the CSV
  let sort = defaultSort ? { ...defaultSort } : null;
  let q = '';
  let fval = 'all';
  let shown = pageSize;
  const open = new Set();

  const val = (col, r) => (col.value ? col.value(r) : r[col.key]);
  const sval = (col, r) => (col.sortValue ? col.sortValue(r) : val(col, r));
  const root = h('div');
  const toolbar = h('div', { class: 'filters' });
  const tbody = h('tbody');
  const thead = h('thead');
  const foot = h('div', { class: 'table-foot' });
  const table = h('table', { class: 'data' }, thead, tbody);
  root.append(toolbar, h('div', { class: 'table-wrap' }, table), foot);

  // header
  const headRow = h('tr');
  if (expand) headRow.append(h('th', { style: { width: '28px' } }));
  for (const col of columns) {
    const th = h('th', { class: col.num ? 'num' : '', scope: 'col' });
    if (col.sortable === false) th.append(col.label);
    else {
      th.append(
        h('button', { type: 'button', onclick: () => {
          sort = sort && sort.key === col.key ? { key: col.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: col.num ? 'desc' : 'asc' };
          shown = pageSize;
          paint();
        } }, col.label, h('span', { 'aria-hidden': 'true', class: 'arrow' }, '')),
      );
    }
    th.dataset.key = col.key;
    headRow.append(th);
  }
  thead.append(headRow);

  // toolbar
  let searchInput = null;
  if (search) {
    searchInput = h('input', { type: 'text', class: 'search', placeholder: search.placeholder || 'Search…', 'aria-label': 'Search table', oninput: (e) => {
      q = e.target.value.toLowerCase();
      shown = pageSize;
      paint();
    } });
    toolbar.append(searchInput);
  }
  const chips = [];
  if (filter) {
    const mk = (value, label) => {
      const b = h('button', { type: 'button', class: 'chip chip-filter', 'aria-pressed': String(value === 'all'), dataset: { v: value }, onclick: () => {
        fval = value;
        shown = pageSize;
        paint();
      } }, label);
      chips.push(b);
      toolbar.append(b);
    };
    mk('all', 'All');
    for (const o of filter.options) mk(o.value, o.label);
  }

  function view() {
    let v = rows;
    if (filter && fval !== 'all') v = v.filter((r) => filter.get(r) === fval);
    if (q && search) v = v.filter((r) => search.text(r).toLowerCase().includes(q));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        v = [...v].sort((a, b) => {
          const x = sval(col, a);
          const y = sval(col, b);
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
        });
      }
    }
    return v;
  }

  function paint() {
    const v = view();
    for (const b of chips) {
      b.setAttribute('aria-pressed', String(b.dataset.v === fval));
      if (filter && b.dataset.v !== 'all') {
        const n = rows.filter((r) => filter.get(r) === b.dataset.v).length;
        b.textContent = `${filter.options.find((o) => o.value === b.dataset.v).label} · ${fmtInt(n)}`;
      } else if (b.dataset.v === 'all') b.textContent = `All · ${fmtInt(rows.length)}`;
    }
    for (const th of headRow.children) {
      const on = sort && th.dataset.key === sort.key;
      th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const arrow = th.querySelector('.arrow');
      if (arrow) arrow.textContent = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
    }
    clear(tbody);
    if (!v.length) {
      tbody.append(h('tr', null, h('td', { colspan: columns.length + (expand ? 1 : 0), class: 'muted' }, empty)));
    }
    for (const r of v.slice(0, shown)) {
      const tr = h('tr', { class: `row${expand ? ' expandable' : ''}` });
      if (expand) {
        tr.append(h('td', { 'aria-hidden': 'true' }, open.has(r) ? '▾' : '▸'));
        tr.addEventListener('click', (e) => {
          if (e.target.closest('a, button, input')) return;
          if (open.has(r)) open.delete(r);
          else open.add(r);
          paint();
        });
      }
      for (const col of columns) {
        const cell = col.render ? col.render(r) : val(col, r);
        tr.append(h('td', { class: `${col.num ? 'num' : ''} ${col.className || ''}`.trim() }, cell == null ? '' : cell));
      }
      tbody.append(tr);
      if (expand && open.has(r)) tbody.append(h('tr', { class: 'detail' }, h('td', { colspan: columns.length + 1 }, expand(r))));
    }
    clear(foot);
    foot.append(h('span', null, `Showing ${fmtInt(Math.min(shown, v.length))} of ${fmtInt(v.length)}${v.length !== rows.length ? ` (filtered from ${fmtInt(rows.length)})` : ''}`));
    const actions = h('span', { class: 'btn-row' });
    if (v.length > shown) actions.append(h('button', { type: 'button', class: 'btn secondary small', onclick: () => {
      shown += pageSize * 2;
      paint();
    } }, 'Show more'));
    if (csvName && v.length) {
      actions.append(h('button', { type: 'button', class: 'btn secondary small', onclick: () => {
        const cols = allColumns.filter((c) => c.csv !== false).map((c) => ({ label: c.csvLabel || c.label, value: (r) => (c.csvValue ? c.csvValue(r) : val(c, r)) }));
        downloadText(csvName, toCSV(cols, view()));
      } }, 'Download CSV'));
    }
    foot.append(actions);
  }
  paint();
  return root;
}
