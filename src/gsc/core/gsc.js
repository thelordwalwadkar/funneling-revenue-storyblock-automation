// Google Search Console access, entirely in the browser.
//  - Sign-in uses Google Identity Services' token flow (no client secret, no backend). You supply an OAuth client ID.
//  - The scope is read-only (webmasters.readonly): this code can never change anything in a Search Console account.
//  - The access token lives in sessionStorage for the life of the tab (so tools opened in the same tab stay signed in).
export const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
// Read-only Search Console plus the account basics (email and name) so we can tell who ran the tool.
export const SIGNIN_SCOPE = SCOPE + ' openid email profile';
const API = 'https://www.googleapis.com/webmasters/v3';
const SS_KEY = 'fr.gsc-token';
const MAX_ROWS_PER_REQUEST = 25000;

export class GscError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let state = null;

function readSaved() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
    if (s && s.expiresAt > Date.now()) return s;
  } catch {
    /* sessionStorage unavailable: fine, sign in again per page */
  }
  return null;
}
function save() {
  try {
    if (state) sessionStorage.setItem(SS_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(SS_KEY);
  } catch {
    /* ignore */
  }
}

/** Remember an access token (also used by tests). */
export function setToken(token, expiresInSec = 3600) {
  state = { token, expiresAt: Date.now() + Math.max(60, Number(expiresInSec) - 60) * 1000 };
  save();
}

export function getToken() {
  if (!state) state = readSaved();
  return state && state.expiresAt > Date.now() ? state.token : null;
}

let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new GscError('Could not load Google sign-in. Check your connection or ad-blocker.'));
      };
      document.head.append(s);
    });
  }
  return gisPromise;
}

/** Opens Google's consent popup. Must be called from a click handler. */
export async function signIn(clientId) {
  if (!clientId) throw new GscError('Google sign-in is not switched on for this site yet.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SIGNIN_SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new GscError(resp.error_description || resp.error));
        const has = window.google.accounts.oauth2.hasGrantedAllScopes;
        if (typeof has === 'function' && !has(resp, SCOPE)) return reject(new GscError('Google did not give the tool permission to read Search Console. Please sign in again and leave the Search Console box ticked.'));
        setToken(resp.access_token, Number(resp.expires_in || 3600));
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new GscError(err?.type === 'popup_closed' ? 'The Google sign-in window was closed.' : err?.message || err?.type || 'Google sign-in failed.')),
    });
    client.requestAccessToken();
  });
}

export function signOut() {
  const t = getToken();
  state = null;
  save();
  try {
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
  } catch {
    /* ignore */
  }
}

async function gfetch(url, { method = 'GET', body } = {}) {
  const token = getToken();
  if (!token) throw new GscError('Your Google session expired. Sign in again.', 401);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    let msg = '';
    let reason = '';
    try {
      const j = await res.json();
      msg = j.error?.message || '';
      reason = j.error?.errors?.[0]?.reason || '';
    } catch {
      /* non-JSON error body */
    }
    const rateLimited = res.status === 429 || (res.status === 403 && /rate|quota/i.test(reason));
    if ((rateLimited || res.status >= 500) && attempt < 4) {
      await sleep(900 * 2 ** attempt + Math.random() * 300);
      continue;
    }
    if (res.status === 401) {
      state = null;
      save();
      throw new GscError('Your Google session expired. Sign in again.', 401);
    }
    if (res.status === 403) throw new GscError(msg || 'No access to this property, or the Search Console API is not enabled for this Google Cloud project.', 403);
    throw new GscError(msg || `Search Console returned HTTP ${res.status}.`, res.status);
  }
}

/** Name and email of the signed-in Google account (null if Google does not return them). */
export async function getProfile() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = await res.json();
    return { email: String(j.email || ''), name: String(j.name || '') };
  } catch {
    return null;
  }
}

/** Google's own index status for one URL (URL Inspection API; the read-only scope is enough). */
export async function inspectUrl(siteUrl, url) {
  const j = await gfetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    body: { inspectionUrl: url, siteUrl, languageCode: 'en' },
  });
  const s = j.inspectionResult?.indexStatusResult || {};
  return {
    verdict: s.verdict || 'VERDICT_UNSPECIFIED', // PASS (indexed), NEUTRAL (excluded), FAIL (error)
    coverage: s.coverageState || '',
    robots: s.robotsTxtState || '',
    indexing: s.indexingState || '',
    lastCrawl: s.lastCrawlTime || '',
    googleCanonical: s.googleCanonical || '',
    userCanonical: s.userCanonical || '',
  };
}

/** Properties the signed-in user can read. */
export async function listSites() {
  const j = await gfetch(`${API}/sites`);
  return (j.siteEntry || [])
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

/**
 * Run a Search Analytics query, following pagination up to rowCap.
 * Returns an array of canonical rows; `truncated` is set when the cap was reached.
 */
export async function queryAll({ siteUrl, startDate, endDate, dimensions, filters = [], rowCap = MAX_ROWS_PER_REQUEST, searchType = 'web', onPage }) {
  const rows = [];
  let startRow = 0;
  let truncated = false;
  for (;;) {
    const limit = Math.min(MAX_ROWS_PER_REQUEST, rowCap - rows.length);
    const body = { startDate, endDate, dimensions, rowLimit: limit, startRow, type: searchType, dataState: 'all' };
    if (filters.length) body.dimensionFilterGroups = [{ groupType: 'and', filters }];
    const j = await gfetch(`${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: 'POST', body });
    const got = j.rows || [];
    for (const r of got) {
      const row = { clicks: r.clicks || 0, impressions: r.impressions || 0, position: r.position > 0 ? r.position : null };
      dimensions.forEach((d, i) => {
        const v = r.keys[i];
        if (d === 'date') {
          row.date = v;
          row.month = v.slice(0, 7);
        } else if (d === 'device' || d === 'country') row[d] = String(v).toLowerCase();
        else row[d] = v;
      });
      rows.push(row);
    }
    onPage?.(rows.length);
    if (got.length < limit) break;
    if (rows.length >= rowCap) {
      truncated = true;
      break;
    }
    startRow += got.length;
  }
  rows.truncated = truncated;
  return rows;
}
