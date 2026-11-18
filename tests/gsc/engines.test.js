import test from 'node:test';
import assert from 'node:assert/strict';
import { runDecay, VERDICT } from '../../src/gsc/engines/decay.js';
import { runCannibalization, classifyProbe } from '../../src/gsc/engines/cannibalization.js';
import { runStriking, benchmarkCtr } from '../../src/gsc/engines/striking.js';
import { runMovement, resolvePeriods } from '../../src/gsc/engines/movement.js';
import { addMonths, monthsBetween } from '../../src/gsc/core/util.js';

const ANCHOR = '2026-09';
const hist = monthsBetween(addMonths(ANCHOR, -15), ANCHOR); // 16 months, index 15 = anchor

/** Build decay rows for one page from 16-slot clicks/impressions arrays (null = no row). */
function pageRows(page, clicks, impr, from = 0) {
  const rows = [];
  for (let i = from; i < hist.length; i++) {
    if (clicks[i] == null) continue;
    rows.push({ month: hist[i], page, clicks: clicks[i], impressions: impr ? impr[i] : clicks[i] * 20 });
  }
  return rows;
}
const fill = (n, v) => new Array(n).fill(v);
const verdictOf = (res, page) => res.rows.find((r) => r.page === page)?.verdict;

// ---------------------------------------------------------------- Content Decay

test('decay: flat page is healthy', () => {
  const res = runDecay(pageRows('/a', fill(16, 100)), { anchorMonth: ANCHOR });
  assert.equal(verdictOf(res, '/a'), VERDICT.HEALTHY);
  assert.equal(res.rows[0].drop, 0);
});

test('decay: small pages are insufficient data', () => {
  const res = runDecay(pageRows('/tiny', fill(16, 5)), { anchorMonth: ANCHOR });
  assert.equal(verdictOf(res, '/tiny'), VERDICT.INSUFFICIENT);
});

test('decay: 24% drop is healthy, 25% drop is not', () => {
  const c24 = [...fill(13, 100), ...fill(3, 76)]; // peak 100, recent 76 => 24%
  const c25 = [...fill(13, 100), ...fill(3, 75)]; // exactly 25%
  const res = runDecay([...pageRows('/p24', c24), ...pageRows('/p25', c25)], { anchorMonth: ANCHOR });
  assert.equal(verdictOf(res, '/p24'), VERDICT.HEALTHY);
  assert.notEqual(verdictOf(res, '/p25'), VERDICT.HEALTHY);
});

test('decay: low season that matches last year is seasonal, not decline', () => {
  const c = fill(16, 100);
  for (const i of [7, 8, 9]) c[i] = 400; // peak window
  const res = runDecay(pageRows('/summer', c), { anchorMonth: ANCHOR });
  const row = res.rows[0];
  assert.equal(row.verdict, VERDICT.SEASONAL);
  assert.equal(row.peakClicks, 400);
  assert.equal(row.peakFrom, hist[7]);
  assert.equal(row.peakTo, hist[9]);
  assert.ok(res.summary.hasYoY);
});

test('decay: real decline with impressions down >10% needs a content refresh', () => {
  const c = [...fill(4, 400), ...fill(9, 300), ...fill(3, 100)];
  const imp = [...fill(4, 4000), ...fill(9, 3000), ...fill(3, 2000)];
  const res = runDecay(pageRows('/old', c, imp), { anchorMonth: ANCHOR });
  assert.equal(res.rows[0].verdict, VERDICT.REFRESH);
  assert.ok(res.rows[0].imprChange < -0.1);
});

test('decay: real decline with impressions steady needs a meta/CTR fix', () => {
  const c = [...fill(4, 400), ...fill(9, 300), ...fill(3, 100)];
  const imp = [...fill(4, 4000), ...fill(9, 4000), ...fill(3, 3700)]; // peak-window impressions 4000 -> 3700 (−7.5%)
  const res = runDecay(pageRows('/ctr', c, imp), { anchorMonth: ANCHOR });
  assert.equal(res.rows[0].verdict, VERDICT.META);
  assert.ok(res.rows[0].imprChange > -0.1);
});

test('decay: without 13 months of history the seasonal check is skipped', () => {
  // Only the last 8 months exist; the page fell from its peak.
  const c = [...fill(8, null), 300, 300, 300, 300, 300, 100, 100, 100];
  const imp = [...fill(8, null), ...fill(5, 3000), ...fill(3, 3000)];
  const res = runDecay(pageRows('/short', c, imp), { anchorMonth: ANCHOR });
  assert.equal(res.summary.hasYoY, false);
  assert.equal(res.rows[0].verdict, VERDICT.META); // impressions flat => meta/CTR
});

test('decay: range limits the peak search', () => {
  const c = fill(16, 100);
  for (const i of [0, 1, 2]) c[i] = 1000; // ancient peak
  const wide = runDecay(pageRows('/x', c), { anchorMonth: ANCHOR, range: 16 });
  const narrow = runDecay(pageRows('/x', c), { anchorMonth: ANCHOR, range: 6 });
  assert.notEqual(wide.rows[0].verdict, VERDICT.HEALTHY);
  assert.equal(narrow.rows[0].verdict, VERDICT.HEALTHY);
});

test('decay: folder filter and month-over-month', () => {
  const rows = [...pageRows('https://x.com/blog/a', fill(16, 100)), ...pageRows('https://x.com/shop/b', fill(16, 100))];
  const res = runDecay(rows, { anchorMonth: ANCHOR, folder: 'blog' });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].page, 'https://x.com/blog/a');
  assert.equal(res.rows[0].momChange, 0);
});

// ---------------------------------------------------------------- Cannibalization

const six = monthsBetween(addMonths(ANCHOR, -5), ANCHOR);
function qp(query, page, monthly) {
  // monthly: array of [clicks, impressions, position] per month (six entries)
  return monthly.map(([clicks, impressions, position], i) => ({ month: six[i], query, page, clicks, impressions, position }));
}
const flat = (c, imp, pos) => fill(6, [c, imp, pos]);
const find = (res, q) => [...res.main, ...res.low].find((r) => r.query === q);

test('cannibalization: priority rules', () => {
  const rows = [
    // HIGH: two best pages 1.5 apart
    ...qp('close', '/a', flat(20, 400, 5)),
    ...qp('close', '/b', flat(15, 400, 6.5)),
    // LOW: one page owns 95% of clicks, gap is large
    ...qp('owned', '/a', flat(19, 300, 2)),
    ...qp('owned', '/c', flat(1, 300, 12)),
    // MEDIUM: gap 5, no owner (70/30)
    ...qp('spread', '/a', flat(14, 300, 4)),
    ...qp('spread', '/d', flat(6, 300, 9)),
  ];
  const res = runCannibalization(rows, { anchorMonth: ANCHOR, range: 6 });
  assert.equal(find(res, 'close').priority, 'high');
  assert.equal(find(res, 'owned').priority, 'low');
  assert.equal(find(res, 'spread').priority, 'medium');
  assert.equal(res.summary.high, 1);
});

test('cannibalization: frequent leader swaps are high priority even when averages are far apart', () => {
  const rows = [
    ...qp('flip', '/a', [[5, 1, 3], [5, 1000, 12], [5, 1, 3], [5, 1000, 12], [5, 1, 3], [5, 1000, 12]]),
    ...qp('flip', '/b', [[5, 1000, 5], [5, 1, 6], [5, 1000, 5], [5, 1, 6], [5, 1000, 5], [5, 1, 6]]),
  ];
  const res = runCannibalization(rows, { anchorMonth: ANCHOR, range: 6, maxPosition: null });
  const r = find(res, 'flip');
  assert.ok(r.gap > 3, `gap was ${r.gap}`);
  assert.equal(r.transitions, 5);
  assert.equal(r.swaps, 5);
  assert.equal(r.priority, 'high');
  assert.ok(r.swapIndicator);
});

test('cannibalization: position depth, positionless pages, folder, brand and keyword filters', () => {
  const rows = [
    ...qp('deep', '/a', flat(10, 300, 4)),
    ...qp('deep', '/b', flat(1, 300, 40)),
    ...qp('nopos', '/a', flat(10, 300, 4)),
    ...qp('nopos', '/b', flat(1, 300, 0)),
    ...qp('mixed folder', '/blog/a', flat(10, 300, 4)),
    ...qp('mixed folder', '/shop/b', flat(10, 300, 8)),
    ...qp('acme shoes', '/a', flat(10, 300, 4)),
    ...qp('acme shoes', '/b', flat(10, 300, 8)),
  ];
  const base = { anchorMonth: ANCHOR, range: 6 };
  assert.equal(find(runCannibalization(rows, { ...base, maxPosition: 20 }), 'deep'), undefined);
  assert.ok(find(runCannibalization(rows, { ...base, maxPosition: null }), 'deep'));
  assert.ok(find(runCannibalization(rows, { ...base, maxPosition: 20 }), 'nopos'));
  assert.ok(find(runCannibalization(rows, base), 'mixed folder'));
  assert.equal(find(runCannibalization(rows, { ...base, folder: '/blog/' }), 'mixed folder'), undefined);
  assert.equal(find(runCannibalization(rows, { ...base, brandTerms: ['acme'] }), 'acme shoes'), undefined);
  assert.ok(find(runCannibalization(rows, { ...base, keywords: ['shoes'] }), 'acme shoes'));
  assert.equal(find(runCannibalization(rows, { ...base, keywords: ['shoes'] }), 'deep'), undefined);
});

test('cannibalization: low-traffic queries are separated and measured by impressions', () => {
  const rows = [
    ...qp('big', '/a', flat(100, 3000, 5)),
    ...qp('big', '/b', flat(80, 3000, 9)),
    ...qp('tiny', '/a', [[0, 40, 6], [0, 40, 6], [1, 40, 6], [0, 40, 6], [0, 40, 6], [0, 40, 6]]),
    ...qp('tiny', '/b', [[0, 10, 11], [0, 10, 11], [0, 10, 11], [0, 10, 11], [0, 10, 11], [0, 10, 11]]),
  ];
  const res = runCannibalization(rows, { anchorMonth: ANCHOR, range: 6 });
  assert.ok(res.main.some((r) => r.query === 'big'));
  const tiny = res.low.find((r) => r.query === 'tiny');
  assert.ok(tiny && tiny.lowTraffic);
  assert.equal(tiny.leader, '/a');
  assert.ok(Math.abs(tiny.pages[0].share - 0.8) < 1e-9); // 240 of 300 impressions
});

test('cannibalization: probe classification', () => {
  assert.equal(classifyProbe({ status: 200, finalUrl: 'https://x.com/a', redirected: false }, 'https://x.com/b').status, 'live');
  assert.equal(classifyProbe({ status: 200, finalUrl: 'https://x.com/b/', redirected: true }, 'https://x.com/b').status, 'merged');
  assert.equal(classifyProbe({ status: 404, finalUrl: 'https://x.com/a', redirected: false }, 'https://x.com/b').status, 'removed');
  assert.equal(classifyProbe({ error: 'timeout' }, 'x').status, 'unreachable');
});

// ---------------------------------------------------------------- Striking distance

test('striking: band edges, demand floor and gain maths', () => {
  const row = (query, impressions, clicks, position) => ({ query, page: '/p', impressions, clicks, position });
  const rows = [
    row('too high', 5000, 700, 3.5), // outside band (above)
    row('edge low', 1000, 30, 4), // gain = 110 - 30 = 80
    row('edge high', 400, 3, 20), // gain = 44 - 3 = 41
    row('too low', 5000, 10, 21), // outside band (below)
    row('tiny demand', 10, 0, 8), // under the 20-impression floor
    row('medium', 200, 5, 9), // 22 - 5 = 17
    row('low', 60, 4, 7), // 6.6 - 4 = 2.6
    row('no gain', 100, 30, 5), // 11 - 30 < 0 => 0
  ];
  const res = runStriking(rows, { band: [4, 20] });
  const by = Object.fromEntries(res.rows.map((r) => [r.query, r]));
  assert.deepEqual(Object.keys(by).sort(), ['edge high', 'edge low', 'low', 'medium', 'no gain']);
  assert.ok(Math.abs(by['edge low'].gain - 80) < 1e-9);
  assert.equal(by['edge low'].priority, 'high');
  assert.equal(by['edge high'].priority, 'high');
  assert.equal(by.medium.priority, 'medium');
  assert.equal(by.low.priority, 'low');
  assert.equal(by['no gain'].gain, 0);
  assert.equal(res.rows[0].query, 'edge low'); // sorted by gain desc
});

test('striking: demand floor scales with the typical in-band pair', () => {
  // typical impressions ~ 10,000 => floor 1,000, so a 500-impression pair drops out.
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push({ query: `q${i}`, page: '/p', impressions: 10000, clicks: 100, position: 8 });
  rows.push({ query: 'small', page: '/p', impressions: 500, clicks: 5, position: 8 });
  const res = runStriking(rows);
  assert.equal(res.summary.demandFloor, 1000);
  assert.ok(!res.rows.some((r) => r.query === 'small'));
});

test('striking: benchmark CTR interpolates and clamps', () => {
  assert.equal(benchmarkCtr(1), 0.285);
  assert.equal(benchmarkCtr(3), 0.11);
  assert.ok(Math.abs(benchmarkCtr(3.5) - 0.095) < 1e-9);
  assert.equal(benchmarkCtr(35), 0.008);
  assert.equal(benchmarkCtr(0), null);
});

test('striking: re-aggregates monthly rows with impression-weighted position', () => {
  const rows = [
    { query: 'q', page: '/p', month: '2026-08', impressions: 900, clicks: 9, position: 6 },
    { query: 'q', page: '/p', month: '2026-09', impressions: 100, clicks: 1, position: 16 },
  ];
  const res = runStriking(rows);
  assert.equal(res.rows[0].impressions, 1000);
  assert.ok(Math.abs(res.rows[0].position - 7) < 1e-9);
});

// ---------------------------------------------------------------- Growth / Loss

const mv = (query, clicks, impressions, position, page = '/p') => ({ query, page, clicks, impressions, position });
// 20 filler queries with 100 clicks keep the typical query at 100 => floor = max(5, 15) = 15
const filler = (period) => Array.from({ length: 20 }, (_, i) => mv(`filler ${i}`, 100, 2000, 5, `/f${i}`));

test('growth: causes', () => {
  const earlier = [
    ...filler(),
    mv('new', 2, 100, 20),
    mv('rank', 40, 1000, 9),
    mv('demand', 40, 1000, 5),
    mv('ctr', 50, 1000, 5),
    mv('mixed', 40, 1000, 5),
    mv('small', 100, 1000, 5),
  ];
  const recent = [
    ...filler(),
    mv('new', 50, 1000, 8),
    mv('rank', 100, 1500, 5), // pos +4, impr +50%
    mv('demand', 100, 2000, 5.2), // pos steady, impr +100%
    mv('ctr', 90, 1050, 5.1), // pos steady, impr +5%
    mv('mixed', 100, 900, 8), // pos worse, impr down, clicks up
    mv('small', 110, 1000, 5), // +10 < floor 15
  ];
  const res = runMovement(recent, earlier, { direction: 'growth' });
  const by = Object.fromEntries(res.rows.map((r) => [r.query, r]));
  assert.equal(res.summary.floor, 15);
  assert.equal(by.new.cause, 'new');
  assert.equal(by.rank.cause, 'ranking');
  assert.equal(by.demand.cause, 'demand');
  assert.equal(by.ctr.cause, 'ctr');
  assert.equal(by.mixed.cause, 'mixed');
  assert.equal(by.small, undefined);
  for (let i = 1; i < res.rows.length; i++) assert.ok(res.rows[i - 1].change >= res.rows[i].change); // biggest change first
});

test('growth: priority is the change relative to the floor', () => {
  const earlier = [...filler(), mv('a', 0, 100, 9), mv('b', 0, 100, 9), mv('c', 0, 100, 9)];
  const recent = [...filler(), mv('a', 120, 500, 5), mv('b', 45, 500, 5), mv('c', 20, 500, 5)];
  const res = runMovement(recent, earlier, { direction: 'growth' });
  const by = Object.fromEntries(res.rows.map((r) => [r.query, r.priority]));
  assert.deepEqual(by, { a: 'high', b: 'medium', c: 'low' }); // 120/15 = 8, 45/15 = 3, 20/15 = 1.3
});

test('loss: mirrored causes', () => {
  const earlier = [
    ...filler(),
    mv('gone', 60, 1000, 5),
    mv('rank', 100, 1500, 5),
    mv('demand', 100, 2000, 5),
    mv('ctr', 90, 1050, 5),
    mv('mixed', 100, 900, 5),
  ];
  const recent = [
    ...filler(),
    mv('gone', 8, 100, 15), // <= 20% of earlier
    mv('rank', 40, 1000, 9), // pos 4 worse, impr -33%
    mv('demand', 40, 1000, 5.2), // pos steady, impr -50%
    mv('ctr', 50, 1000, 5.1), // pos steady, impr -5%
    mv('mixed', 60, 1200, 8), // pos worse but impressions up
  ];
  const res = runMovement(recent, earlier, { direction: 'loss' });
  const by = Object.fromEntries(res.rows.map((r) => [r.query, r.cause]));
  assert.deepEqual(by, { gone: 'new', rank: 'ranking', demand: 'demand', ctr: 'ctr', mixed: 'mixed' });
  assert.equal(res.rows.find((r) => r.query === 'gone').causeLabel, 'Keyword lost');
  assert.ok(res.rows.every((r) => r.change > 0)); // losses are reported as positive clicks lost
});

test('internal shifts are set aside, not counted as growth or loss', () => {
  // Query gains 60 clicks on /a and loses 40 on /b: net +20 (>= floor), opposing 40 >= 60% of 60.
  const earlier = [...filler(), mv('shift', 40, 800, 6, '/a'), mv('shift', 80, 800, 6, '/b'), mv('real', 40, 800, 6, '/a'), mv('real', 40, 800, 6, '/b')];
  const recent = [...filler(), mv('shift', 100, 800, 6, '/a'), mv('shift', 40, 800, 6, '/b'), mv('real', 140, 800, 6, '/a'), mv('real', 30, 800, 6, '/b')];
  const growth = runMovement(recent, earlier, { direction: 'growth' });
  assert.deepEqual(growth.shifts.map((s) => s.query), ['shift']);
  assert.deepEqual(growth.rows.map((s) => s.query), ['real']); // +100 on /a, −10 on /b => opposing 10% => real
  const loss = runMovement(recent, earlier, { direction: 'loss' });
  assert.ok(!loss.rows.some((r) => r.query === 'shift')); // net result is growth, so it is not a loss
});

test('brand terms are excluded', () => {
  const earlier = [...filler(), mv('acme login', 0, 100, 1)];
  const recent = [...filler(), mv('acme login', 500, 900, 1)];
  assert.equal(runMovement(recent, earlier, { direction: 'growth', brandTerms: ['acme'] }).rows.length, 0);
  assert.equal(runMovement(recent, earlier, { direction: 'growth' }).rows.length, 1);
});

test('period presets resolve to back-to-back windows', () => {
  const p = resolvePeriods({ preset: '3', anchorMonth: '2026-09' });
  assert.deepEqual(p.recent, { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(p.earlier, { from: '2026-04-01', to: '2026-06-30' });
  const p8 = resolvePeriods({ preset: '8', anchorMonth: '2026-09' });
  assert.deepEqual(p8.recent, { from: '2026-02-01', to: '2026-09-30' });
  assert.deepEqual(p8.earlier, { from: '2025-06-01', to: '2026-01-31' });
  const c = resolvePeriods({ preset: 'custom', custom: { recentFrom: 'a', recentTo: 'b', earlierFrom: 'c', earlierTo: 'd' } });
  assert.deepEqual(c, { recent: { from: 'a', to: 'b' }, earlier: { from: 'c', to: 'd' } });
});
