import type { APIRoute } from 'astro';
import { clientIp, rateLimit, withSlot } from '../../lib/server/ops';
import { crawlOne, hostKey, originFromProperty, readSitemaps, readUnlockToken, type CrawlResult } from '../../lib/server/reports';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * POST /api/report-crawl/ reads the visitor's own site for the Index Bloat and Internal Link Gap reports.
 *   { token, site, action: 'sitemap' }                 -> URLs listed in the site's sitemap(s)
 *   { token, site, action: 'pages', urls: [..up to 8] } -> content links and text of those pages
 * Needs the unlock token from /api/report-lead/. Only pages on the same site as `site` are fetched, and every request
 * goes through safeFetch (no private addresses, no redirects off-site).
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
	let body: { token?: string; site?: string; action?: string; urls?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Send a JSON body.' }, 400);
	}
	const lead = readUnlockToken(body.token);
	if (!lead) return json({ ok: false, error: 'This report is unlocked with the short form. Fill it in and try again.', locked: true }, 401);

	const ip = clientIp(request, clientAddress);
	if (rateLimit(`crawl-ip:${ip}`, 150, 60 * 60_000) || rateLimit(`crawl-tok:${lead.id}`, 100, 60 * 60_000)) {
		return json({ ok: false, error: 'You have used a lot of checks this hour. Please try again later.' }, 429);
	}

	let origin: URL;
	try {
		origin = originFromProperty(String(body.site ?? ''));
	} catch {
		return json({ ok: false, error: 'That does not look like a website address.' }, 400);
	}

	try {
		if (body.action === 'sitemap') {
			const r = await withSlot(() => readSitemaps(origin), 4);
			return json({ ok: true, ...r });
		}
		if (body.action === 'pages') {
			const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === 'string').slice(0, 8) : [];
			if (!urls.length) return json({ ok: false, error: 'No pages given.' }, 400);
			const host = hostKey(origin.hostname);
			const out: CrawlResult[] = new Array(urls.length);
			let next = 0;
			await withSlot(async () => {
				await Promise.all(
					Array.from({ length: Math.min(4, urls.length) }, async () => {
						while (next < urls.length) {
							const i = next++;
							out[i] = await crawlOne(urls[i], host);
						}
					}),
				);
			}, 4);
			return json({ ok: true, pages: out });
		}
		return json({ ok: false, error: 'Unknown action.' }, 400);
	} catch (e) {
		if ((e as { code?: string }).code === 'busy') return json({ ok: false, error: 'The checker is busy. Try again in a few seconds.' }, 503);
		return json({ ok: false, error: 'Could not read that site.' }, 502);
	}
};
