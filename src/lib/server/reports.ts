/**
 * Server helpers for the Search Console tools and the three gated reports:
 *  - unlock tokens (signed, so the crawl endpoint can tell a visitor passed the lead form)
 *  - reading a page's own content links and plain text (for the Internal Link Gap report)
 *  - reading a site's sitemap(s) (for the Index Bloat report)
 *
 * Every outbound request goes through safeFetch (src/lib/server/safe-fetch.ts); nothing here calls fetch on a
 * user-supplied address directly. Search Console data and Google access tokens never reach the server.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { safeFetch } from './safe-fetch';

const env = (k: string) => process.env[k]?.trim() || '';

/* -------------------------------- unlock tokens ------------------------------- */

const FALLBACK_SECRET = randomBytes(32).toString('hex'); // used only when no secret is configured (tokens then reset on restart)
const secret = () => env('REPORT_SECRET') || env('ADMIN_TOKEN') || FALLBACK_SECRET;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');
const TOKEN_DAYS = 14;

export function makeUnlockToken(leadId: string, email: string): string {
	const body = b64(JSON.stringify({ id: leadId, e: email, exp: Date.now() + TOKEN_DAYS * 86_400_000 }));
	return `${body}.${sign(body)}`;
}

export function readUnlockToken(token: string | null | undefined): { id: string; email: string } | null {
	if (!token || typeof token !== 'string') return null;
	const [body, sig] = token.split('.');
	if (!body || !sig) return null;
	const want = Buffer.from(sign(body));
	const got = Buffer.from(sig);
	if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
	try {
		const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
		if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
		return { id: String(p.id), email: String(p.e) };
	} catch {
		return null;
	}
}

/* ------------------------------ address helpers ------------------------------- */

export const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** A Search Console property ("sc-domain:example.com" or "https://example.com/") as a fetchable origin. */
export function originFromProperty(property: string): URL {
	const p = String(property || '').trim();
	const raw = p.startsWith('sc-domain:') ? `https://${p.slice('sc-domain:'.length)}/` : p;
	const u = new URL(raw);
	if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Not a website address.');
	return new URL(`${u.protocol}//${u.host}/`);
}

/* ------------------------------ page reading ---------------------------------- */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: '-', ndash: '-', hellip: '...' };
const decode = (s: string) =>
	s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
const squash = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const dropTag = (html: string, tag: string) => html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|gz|mp4|mp3|docx?|xlsx?|pptx?|css|js|xml|json|txt)$/i;

export interface PageRead {
	title: string;
	text: string;
	links: { to: string; anchor: string }[];
	textLength: number;
}

/** Content links and plain text of one HTML page. Menu, header, footer and sidebar are removed first. */
export function readPage(html: string, finalUrl: string): PageRead {
	let page = html.replace(/<!--[\s\S]*?-->/g, ' ');
	for (const t of ['script', 'style', 'noscript', 'svg', 'template']) page = dropTag(page, t);
	const title = squash((page.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');

	let region = (page.match(/<main\b[\s\S]*?<\/main\s*>/i) || [])[0] || (page.match(/<article\b[\s\S]*?<\/article\s*>/i) || [])[0] || (page.match(/<body\b[\s\S]*<\/body\s*>/i) || [])[0] || page;
	for (let i = 0; i < 3; i++) for (const t of ['nav', 'header', 'footer', 'aside']) region = dropTag(region, t);

	const base = new URL(finalUrl);
	const here = hostKey(base.hostname);
	const seen = new Set<string>();
	const links: { to: string; anchor: string }[] = [];
	const re = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(region)) && links.length < 400) {
		const href = decode((m[1] ?? m[2] ?? m[3] ?? '').trim());
		if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(href)) continue;
		if (/\brel\s*=\s*["'][^"']*nofollow/i.test(m[0].slice(0, m[0].indexOf('>') + 1))) continue;
		let u: URL;
		try {
			u = new URL(href, base);
		} catch {
			continue;
		}
		if ((u.protocol !== 'http:' && u.protocol !== 'https:') || hostKey(u.hostname) !== here || SKIP_EXT.test(u.pathname)) continue;
		u.hash = '';
		const to = u.toString();
		if (seen.has(to)) continue;
		seen.add(to);
		let anchor = squash(m[4]);
		if (!anchor) anchor = (m[4].match(/<img[^>]*\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
		links.push({ to, anchor: decode(anchor).slice(0, 120) });
	}

	const text = squash(region).toLowerCase();
	return { title: title.slice(0, 160), text: text.slice(0, 8000), links, textLength: text.length };
}

export interface CrawlResult extends Partial<PageRead> {
	url: string;
	status: number;
	error?: string;
}

/** Fetch one page for the link report. Never throws. */
export async function crawlOne(url: string, siteHost: string): Promise<CrawlResult> {
	try {
		const u = new URL(url);
		if (hostKey(u.hostname) !== siteHost) return { url, status: 0, error: 'Not on the same site.' };
		const res = await safeFetch(u, { maxBytes: 1_200_000, timeoutMs: 8000, maxRedirects: 3 });
		const final = new URL(res.finalUrl);
		if (hostKey(final.hostname) !== siteHost) return { url, status: res.status, error: 'Redirects to another site.' };
		if (res.status < 200 || res.status >= 300) return { url, status: res.status };
		if (!/html/i.test(String(res.headers['content-type'] ?? 'text/html'))) return { url, status: res.status, error: 'Not an HTML page.' };
		return { url, status: res.status, ...readPage(res.body, res.finalUrl) };
	} catch (e) {
		return { url, status: 0, error: (e as Error).message || 'Could not fetch.' };
	}
}

/* ------------------------------- sitemaps ------------------------------------- */

/** One retry: the first request to a cold site is the one most likely to time out. */
const fetchTwice = async (u: URL, opts: Parameters<typeof safeFetch>[1]) => {
	try {
		return await safeFetch(u, opts);
	} catch {
		return await safeFetch(u, opts);
	}
};

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1].trim()));

/** Reads the sitemap(s) of a site (robots.txt first, then the usual names). Caps at 5,000 URLs / 25 files. */
export async function readSitemaps(origin: URL, maxUrls = 5000): Promise<{ urls: string[]; files: string[]; truncated: boolean }> {
	const host = hostKey(origin.hostname);
	const deadline = Date.now() + 40_000; // never hold the request longer than this
	const queue: string[] = [];
	try {
		const robots = await fetchTwice(new URL('/robots.txt', origin), { maxBytes: 200_000, timeoutMs: 6000, maxRedirects: 2, accept: 'text/plain,*/*;q=0.5' });
		if (robots.status === 200) for (const line of robots.body.split(/\r?\n/)) if (/^sitemap:/i.test(line)) queue.push(line.replace(/^sitemap:/i, '').trim());
	} catch {
		/* no robots.txt is fine */
	}
	if (!queue.length) queue.push(new URL('/sitemap.xml', origin).toString(), new URL('/sitemap_index.xml', origin).toString());

	const urls = new Set<string>();
	const files: string[] = [];
	const done = new Set<string>();
	let truncated = false;
	while (queue.length && files.length < 25 && !truncated && Date.now() < deadline) {
		const next = queue.shift()!;
		if (done.has(next)) continue;
		done.add(next);
		let u: URL;
		try {
			u = new URL(next);
		} catch {
			continue;
		}
		if (hostKey(u.hostname) !== host || /\.gz$/i.test(u.pathname)) continue;
		try {
			const res = await fetchTwice(u, { maxBytes: 4_000_000, timeoutMs: 9000, maxRedirects: 2, accept: 'application/xml,text/xml,*/*;q=0.5' });
			if (res.status !== 200 || !/<(urlset|sitemapindex)\b/i.test(res.body)) continue;
			files.push(next);
			const found = locs(res.body);
			if (/<sitemapindex\b/i.test(res.body)) queue.push(...found);
			else
				for (const l of found) {
					urls.add(l);
					if (urls.size >= maxUrls) {
						truncated = true;
						break;
					}
				}
		} catch {
			/* skip a sitemap that cannot be read */
		}
	}
	return { urls: [...urls], files, truncated };
}
