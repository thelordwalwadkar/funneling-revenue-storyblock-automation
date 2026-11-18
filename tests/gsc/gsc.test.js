// Tests the Search Console client against a fake Google endpoint (no network, no real account).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GscError, getToken, listSites, queryAll, setToken, signOut } from '../../src/gsc/core/gsc.js';
import { GscSource } from '../../src/gsc/core/sources.js';

const realFetch = globalThis.fetch;
const calls = [];
/** Install a fake fetch; `handler(url, init, body)` returns { status, json }. */
function fake(handler) {
  calls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), init, body });
    const r = await handler(String(url), init, body, calls.length);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json ?? {} };
  };
}
test.afterEach(() => {
  globalThis.fetch = realFetch;
});
test.beforeEach(() => setToken('test-token', 3600));

const rowsOf = (n, make) => Array.from({ length: n }, (_, i) => make(i));

test('gsc: sends the bearer token, encodes the property, and follows pagination', async () => {
  fake((url, init, body, n) => ({ status: 200, json: { rows: n === 1 ? rowsOf(25000, (i) => ({ keys: [`q${i}`], clicks: 1, impressions: 10, position: 3 })) : rowsOf(10, (i) => ({ keys: [`z${i}`], clicks: 1, impressions: 10, position: 3 })) } }));
  const rows = await queryAll({ siteUrl: 'sc-domain:example.com', startDate: '2026-08-01', endDate: '2026-08-31', dimensions: ['query'], rowCap: 60000 });
  assert.equal(rows.length, 25010);
  assert.equal(rows.truncated, false);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /sites\/sc-domain%3Aexample\.com\/searchAnalytics\/query$/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token');
  assert.deepEqual([calls[0].body.startRow, calls[1].body.startRow], [0, 25000]);
  assert.equal(calls[0].body.rowLimit, 25000);
  assert.equal(calls[0].body.type, 'web');
});

test('gsc: respects the row cap and flags truncation', async () => {
  fake((url, init, body) => ({ status: 200, json: { rows: rowsOf(body.rowLimit, (i) => ({ keys: [`q${i}`], clicks: 1, impressions: 5, position: 2 })) } }));
  const rows = await queryAll({ siteUrl: 'https://example.com/', startDate: '2026-08-01', endDate: '2026-08-31', dimensions: ['query'], rowCap: 100 });
  assert.equal(rows.length, 100);
  assert.equal(rows.truncated, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.rowLimit, 100);
});

test('gsc: maps dimensions, lower-cases device and country, nulls a zero position', async () => {
  fake(() => ({ status: 200, json: { rows: [{ keys: ['2026-08-05', 'MOBILE', 'GBR', 'Blue Shoes', 'https://x.com/a'], clicks: 4, impressions: 40, position: 0 }] } }));
  const [r] = await queryAll({ siteUrl: 'https://x.com/', startDate: '2026-08-01', endDate: '2026-08-31', dimensions: ['date', 'device', 'country', 'query', 'page'] });
  assert.deepEqual(r, { clicks: 4, impressions: 40, position: null, date: '2026-08-05', month: '2026-08', device: 'mobile', country: 'gbr', query: 'Blue Shoes', page: 'https://x.com/a' });
});

test('gsc: retries on rate limits and server errors, then succeeds', async () => {
  fake((url, init, body, n) => (n === 1 ? { status: 429, json: { error: { message: 'slow down' } } } : n === 2 ? { status: 403, json: { error: { errors: [{ reason: 'rateLimitExceeded' }], message: 'quota' } } } : { status: 200, json: { rows: [{ keys: ['a'], clicks: 1, impressions: 1, position: 1 }] } }));
  const rows = await queryAll({ siteUrl: 'https://x.com/', startDate: '2026-08-01', endDate: '2026-08-31', dimensions: ['query'] });
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 3);
});

test('gsc: a 401 clears the session and tells the user to sign in again', async () => {
  fake(() => ({ status: 401, json: { error: { message: 'Invalid Credentials' } } }));
  await assert.rejects(() => queryAll({ siteUrl: 'https://x.com/', startDate: '2026-08-01', endDate: '2026-08-31', dimensions: ['query'] }), (e) => e instanceof GscError && e.status === 401 && /sign in again/i.test(e.message));
  assert.equal(getToken(), null);
});

test('gsc: a real 403 surfaces Google\'s own message and is not retried', async () => {
  fake(() => ({ status: 403, json: { error: { message: 'User does not have sufficient permission for site', errors: [{ reason: 'forbidden' }] } } }));
  await assert.rejects(() => queryAll({ siteUrl: 'https://x.com/', startDate: '2026-08-01', endDate: '2026-08-31', dimensions: ['query'] }), /sufficient permission/);
  assert.equal(calls.length, 1);
});

test('gsc: no token means no request', async () => {
  signOut();
  globalThis.fetch = async () => assert.fail('must not call Google without a token');
  await assert.rejects(() => listSites(), /sign in again/i);
});

test('gsc: lists only properties the user can actually read', async () => {
  fake(() => ({ status: 200, json: { siteEntry: [{ siteUrl: 'https://b.com/', permissionLevel: 'siteOwner' }, { siteUrl: 'https://a.com/', permissionLevel: 'siteFullUser' }, { siteUrl: 'https://c.com/', permissionLevel: 'siteUnverifiedUser' }] } }));
  assert.deepEqual((await listSites()).map((s) => s.siteUrl), ['https://a.com/', 'https://b.com/']);
});

test('GscSource: one request per month with exact windows, filters pushed to Google, rows stamped with their month', async () => {
  fake((url, init, body) => ({ status: 200, json: { rows: [{ keys: [`q ${body.startDate}`, 'https://x.com/blog/a'], clicks: 2, impressions: 20, position: 4 }, { keys: ['elsewhere', 'https://x.com/shop/b'], clicks: 1, impressions: 9, position: 7 }] } }));
  const src = new GscSource({ siteUrl: 'https://x.com/', today: new Date('2026-10-05T00:00:00Z') });
  assert.equal(src.defaultAnchor(), '2026-09');
  assert.equal(src.months().length, 16);
  const rows = await src.get({ dims: ['query', 'page'], from: '2026-07-01', to: '2026-09-30', byMonth: true, filters: { country: 'GBR', pathPrefix: 'blog/' }, rowCap: 5000 });
  assert.deepEqual(calls.map((c) => [c.body.startDate, c.body.endDate]), [['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30']]);
  for (const c of calls) {
    assert.deepEqual(c.body.dimensions, ['query', 'page']);
    assert.deepEqual(c.body.dimensionFilterGroups[0].filters, [{ dimension: 'page', operator: 'contains', expression: '/blog/' }, { dimension: 'country', operator: 'equals', expression: 'gbr' }]);
    assert.equal(c.body.rowLimit, 5000);
  }
  assert.deepEqual(rows.map((r) => r.month), ['2026-07', '2026-08', '2026-09']); // the /shop/ row is dropped client-side too
  assert.ok(rows.every((r) => r.page.includes('/blog/')));
});

test('GscSource: a single range is one request and rows carry no month', async () => {
  fake(() => ({ status: 200, json: { rows: [{ keys: ['a', 'https://x.com/p'], clicks: 1, impressions: 2, position: 3 }] } }));
  const src = new GscSource({ siteUrl: 'https://x.com/' });
  const rows = await src.get({ dims: ['query', 'page'], from: '2026-07-01', to: '2026-09-30' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.dimensionFilterGroups, undefined);
  assert.equal(rows[0].month, undefined);
});
