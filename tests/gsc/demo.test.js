// The demo dataset doubles as an end-to-end check: every tool must find something to show in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoRows, DEMO_BRAND } from '../../src/gsc/core/demo.js';
import { describeRows } from '../../src/gsc/core/csv.js';
import { runDecay, VERDICT } from '../../src/gsc/engines/decay.js';
import { runCannibalization } from '../../src/gsc/engines/cannibalization.js';
import { runStriking } from '../../src/gsc/engines/striking.js';
import { runMovement, resolvePeriods } from '../../src/gsc/engines/movement.js';
import { monthEnd, monthStart, addMonths } from '../../src/gsc/core/util.js';

const ANCHOR = '2026-09';
const rows = generateDemoRows({ anchorMonth: ANCHOR });
const dateOf = (r) => r.month;
const between = (from, to) => rows.filter((r) => monthStart(dateOf(r)) >= monthStart(from.slice(0, 7)) && dateOf(r) <= to.slice(0, 7));

test('demo data is deterministic and well-formed', () => {
  const again = generateDemoRows({ anchorMonth: ANCHOR });
  assert.equal(again.length, rows.length);
  assert.deepEqual(again[1234], rows[1234]);
  const d = describeRows(rows);
  assert.deepEqual([d.query, d.page, d.country, d.device, d.time], [true, true, true, true, 'month']);
  assert.equal(d.minMonth, addMonths(ANCHOR, -17));
  assert.equal(d.maxMonth, ANCHOR);
  assert.ok(rows.every((r) => r.clicks >= 0 && r.impressions >= r.clicks && r.position >= 1));
});

test('demo: content decay shows every verdict', () => {
  const pageMonth = rows.map((r) => ({ month: r.month, page: r.page, clicks: r.clicks, impressions: r.impressions }));
  const res = runDecay(pageMonth, { anchorMonth: ANCHOR });
  const verdicts = new Set(res.rows.map((r) => r.verdict));
  for (const v of Object.values(VERDICT)) assert.ok(verdicts.has(v), `missing verdict ${v}; got ${[...verdicts]}`);
  const byPage = Object.fromEntries(res.rows.map((r) => [r.page.split('/').pop(), r.verdict]));
  assert.equal(byPage['summer-running-tips'], VERDICT.SEASONAL);
  assert.equal(byPage['home-gym-ideas-2024'], VERDICT.REFRESH);
  assert.equal(byPage['jump-rope-guide'], VERDICT.META);
  assert.equal(byPage['best-rowing-machines'], VERDICT.HEALTHY);
  assert.equal(byPage['grip-strength-trainers'], VERDICT.INSUFFICIENT);
});

test('demo: cannibalization shows every priority and a low-traffic section', () => {
  const res = runCannibalization(rows, { anchorMonth: ANCHOR, range: 12, brandTerms: [DEMO_BRAND] });
  const pri = new Set([...res.main, ...res.low].map((r) => r.priority));
  assert.deepEqual([...pri].sort(), ['high', 'low', 'medium']);
  assert.ok(res.low.some((r) => r.query === 'micro loop bands'));
  const q = (name) => res.main.find((r) => r.query === name);
  assert.equal(q('best rowing machine').priority, 'high');
  assert.equal(q('kettlebell weight chart').priority, 'low');
  assert.equal(q('foam roller exercises').priority, 'medium');
  assert.ok(q('yoga mat thickness').swapIndicator);
  assert.ok(!res.main.some((r) => r.query.startsWith(DEMO_BRAND)));
});

test('demo: striking distance finds opportunities of each size', () => {
  const recent = between(addMonths(ANCHOR, -2), monthEnd(ANCHOR));
  const res = runStriking(recent, { band: [4, 20], brandTerms: [DEMO_BRAND] });
  assert.ok(res.summary.high >= 3, JSON.stringify(res.summary));
  assert.ok(res.summary.medium >= 1);
  assert.ok(res.rows.every((r) => r.position >= 4 && r.position <= 20));
  assert.ok(res.rows[0].gain >= res.rows[res.rows.length - 1].gain);
});

test('demo: growth and loss find every cause and an internal shift', () => {
  const p = resolvePeriods({ preset: '3', anchorMonth: ANCHOR });
  const slice = (w) => rows.filter((r) => r.month >= w.from.slice(0, 7) && r.month <= w.to.slice(0, 7));
  const rec = slice(p.recent);
  const ear = slice(p.earlier);
  const growth = runMovement(rec, ear, { direction: 'growth', brandTerms: [DEMO_BRAND] });
  const loss = runMovement(rec, ear, { direction: 'loss', brandTerms: [DEMO_BRAND] });
  const gc = growth.rows.reduce((m, r) => ({ ...m, [r.query]: r.cause }), {});
  const lc = loss.rows.reduce((m, r) => ({ ...m, [r.query]: r.cause }), {});
  assert.equal(gc['rowing machine for small spaces'], 'new');
  assert.equal(gc['best rowing machine under 500'], 'ranking');
  assert.equal(gc['standing desk height calculator'], 'demand');
  assert.equal(gc['yoga mat cleaning'], 'ctr');
  assert.equal(gc['kettlebell swing form'], 'mixed');
  assert.equal(lc['home gym equipment list'], 'new');
  assert.equal(lc['best dumbbells for home'], 'ranking');
  assert.equal(lc['pull up bar installation'], 'demand');
  assert.equal(lc['jump rope workout'], 'ctr');
  assert.equal(lc['exercise bike resistance levels'], 'mixed');
  assert.ok(growth.shifts.some((s) => s.query === 'yoga mat for pilates'), 'internal shift expected in growth');
  assert.ok(!growth.rows.some((s) => s.query === 'yoga mat for pilates'));
});
