import test from 'node:test';
import assert from 'node:assert/strict';
import { importCSV, parseCSV, parseDateLike, guessMonthFromName, describeRows } from '../../src/gsc/core/csv.js';
import { MemorySource } from '../../src/gsc/core/sources.js';
import { toCountryCode, matchCountry } from '../../src/gsc/core/countries.js';
import { toCSV, csvEscape, Agg } from '../../src/gsc/core/util.js';

test('csv: quotes, embedded commas/newlines and BOM', () => {
  const { rows } = parseCSV('﻿a,b\n"x, y","line1\nline2"\n"he said ""hi""",3\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'line1\nline2'], ['he said "hi"', '3']]);
});

test('csv: detects semicolon and tab delimiters', () => {
  assert.equal(parseCSV('a;b;c\n1;2;3').delimiter, ';');
  assert.equal(parseCSV('a\tb\tc\n1\t2\t3').delimiter, '\t');
  assert.equal(parseCSV('a,b,c\n1,2,3').delimiter, ',');
});

test('csv: Search Console "Landing page – Query" export with varied headers', () => {
  const text = 'Top queries,Top pages,Clicks,Impressions,CTR,Position\n"pump hire",https://x.nl/hire,1200,"34,500",3.5%,4.2\nseal kit,https://x.nl/kit,0,80,0%,18.3\n';
  const { rows, meta } = importCSV(text, { assumeMonth: '2025-03' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { clicks: 1200, impressions: 34500, position: 4.2, query: 'pump hire', page: 'https://x.nl/hire', month: '2025-03' });
  assert.ok(meta.hasQuery && meta.hasPage && !meta.hasDate);
});

test('csv: date columns in different formats resolve to months', () => {
  for (const [input, month, date] of [
    ['2025-03-07', '2025-03', '2025-03-07'],
    ['2025-03', '2025-03', undefined],
    ['Dec 2024', '2024-12', undefined],
    ['Feb-25', '2025-02', undefined],
    ['September 2025', '2025-09', undefined],
    ['2025 Sep', '2025-09', undefined],
    ['31/12/2025', '2025-12', '2025-12-31'],
    ['12/31/2025', '2025-12', '2025-12-31'],
    ['Dec 5, 2025', '2025-12', '2025-12-05'],
  ]) {
    const d = parseDateLike(input);
    assert.equal(d?.month, month, input);
    assert.equal(d?.date, date, input);
  }
  assert.equal(parseDateLike('not a date'), null);
});

test('csv: decimal commas with semicolons, missing impressions derived from CTR', () => {
  const { rows } = importCSV('Query;Clicks;Impressions;Position;Date\nfoo;10;200;"5,5";2025-01-02\n');
  assert.equal(rows[0].position, 5.5);
  const derived = importCSV('Query,Clicks,CTR\nfoo,10,5%\n').rows[0];
  assert.equal(derived.impressions, 200);
});

test('csv: files without clicks/impressions are rejected with a helpful message', () => {
  const { rows, meta } = importCSV('Query,Page\na,b\n');
  assert.equal(rows.length, 0);
  assert.match(meta.error, /Clicks or Impressions/);
});

test('csv: month guessed from file names', () => {
  assert.equal(guessMonthFromName('LP - Query 2025-03.csv'), '2025-03');
  assert.equal(guessMonthFromName('Landing Page Mar 2025.csv'), '2025-03');
  assert.equal(guessMonthFromName('2025_3_Mar queries.csv'), '2025-03');
  assert.equal(guessMonthFromName('queries.csv'), null);
});

test('memory source: filters by date/month, groups by dims, weights position by impressions', async () => {
  const rows = [
    { month: '2026-01', query: 'a', page: '/p1', country: 'usa', clicks: 10, impressions: 100, position: 4 },
    { month: '2026-01', query: 'a', page: '/p1', country: 'gbr', clicks: 5, impressions: 300, position: 8 },
    { month: '2026-02', query: 'a', page: '/p1', country: 'usa', clicks: 1, impressions: 50, position: 3 },
    { month: '2026-02', query: 'b', page: '/blog/p2', country: 'usa', clicks: 2, impressions: 20, position: 9 },
  ];
  const s = new MemorySource(rows, { today: new Date('2026-03-15T00:00:00Z') });
  assert.equal(s.defaultAnchor(), '2026-02');
  assert.deepEqual(s.months(), ['2026-01', '2026-02']);
  const jan = await s.get({ dims: ['query', 'page'], from: '2026-01-01', to: '2026-01-31' });
  assert.equal(jan.length, 1);
  assert.equal(jan[0].clicks, 15);
  assert.equal(jan[0].impressions, 400);
  assert.ok(Math.abs(jan[0].position - 7) < 1e-9); // (4*100 + 8*300) / 400
  const monthly = await s.get({ dims: ['page'], from: '2026-01-01', to: '2026-02-28', byMonth: true });
  assert.equal(monthly.length, 3);
  assert.ok(monthly.every((r) => r.month));
  const usa = await s.get({ dims: ['query'], from: '2026-01-01', to: '2026-02-28', filters: { country: 'United States' } });
  assert.equal(usa.find((r) => r.query === 'a').clicks, 11);
  const blog = await s.get({ dims: ['page'], from: '2026-01-01', to: '2026-02-28', filters: { pathPrefix: 'blog' } });
  assert.deepEqual(blog.map((r) => r.page), ['/blog/p2']);
});

test('memory source: a partial current month is never the anchor; undated data still works', async () => {
  const s = new MemorySource([{ month: '2026-03', clicks: 1, impressions: 2, position: 3 }], { today: new Date('2026-03-15T00:00:00Z') });
  assert.equal(s.defaultAnchor(), '2026-02');
  const undated = new MemorySource([{ query: 'a', clicks: 4, impressions: 40, position: 5 }]);
  assert.equal(undated.capabilities().time, null);
  const got = await undated.get({ dims: ['query'], from: '2026-01-01', to: '2026-01-31' });
  assert.equal(got[0].clicks, 4); // no time information at all => ranges are ignored
  assert.deepEqual(describeRows([{ query: 'a', month: '2026-01' }]).time, 'month');
});

test('countries: names and codes match each other', () => {
  assert.equal(toCountryCode('United States'), 'usa');
  assert.equal(toCountryCode('GBR'), 'gbr');
  assert.ok(matchCountry('India', 'ind'));
  assert.ok(!matchCountry('India', 'usa'));
  assert.ok(matchCountry('anything', ''));
});

test('csv export neutralises spreadsheet formulas but keeps numbers', () => {
  assert.equal(csvEscape('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvEscape(-12.5), '-12.5');
  assert.equal(csvEscape('a,b'), '"a,b"');
  const out = toCSV([{ label: 'Q', value: (r) => r.q }, { label: 'N', value: (r) => r.n }], [{ q: '+cmd', n: 3 }]);
  assert.equal(out, "Q,N\n'+cmd,3\n");
});

test('Agg: impression-weighted position ignores rows without a position', () => {
  const a = new Agg().add({ clicks: 1, impressions: 100, position: 2 }).add({ clicks: 1, impressions: 100, position: null }).add({ clicks: 0, impressions: 100, position: 6 });
  assert.equal(a.position, 4);
  assert.equal(a.clicks, 2);
});
