import type { APIRoute } from 'astro';
import { analyze, type ToolId } from '../../lib/server/analyze';
import { FetchError, normalizeUrl } from '../../lib/server/safe-fetch';
import { cacheGet, cacheSet, clientIp, hashIp, notify, rateLimit, saveSubmission, withSlot } from '../../lib/server/ops';

export const prerender = false;

const TOOLS: ToolId[] = ['audit', 'ai-visibility', 'serp-preview'];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let payload: { tool?: string; url?: string };
	try {
		payload = await request.json();
	} catch {
		return json({ ok: false, error: 'Send a JSON body: { "tool": "...", "url": "..." }.' }, 400);
	}
	const tool = payload.tool as ToolId;
	if (!TOOLS.includes(tool)) return json({ ok: false, error: `Unknown tool. Use one of: ${TOOLS.join(', ')}.` }, 400);

	const ip = clientIp(request, clientAddress);
	const wait = rateLimit(`analyze:${ip}`, 12, 60 * 60_000);
	if (wait) return json({ ok: false, error: `You have run a lot of checks. Try again in ${Math.ceil(wait / 60)} minute(s).` }, 429, { 'retry-after': String(wait) });

	let normalized: string;
	try {
		normalized = normalizeUrl(payload.url ?? '').toString();
	} catch (e) {
		return json({ ok: false, error: (e as Error).message }, 400);
	}

	const key = `${tool}:${normalized}`;
	const cached = cacheGet<unknown>(key);
	if (cached) return json({ ok: true, cached: true, result: cached });

	try {
		const result = await withSlot(() => analyze(tool, normalized));
		cacheSet(key, result);
		const record = await saveSubmission({
			kind: 'tool',
			tool,
			url: result.url,
			host: result.host,
			score: result.score,
			grade: result.grade,
			topFixes: result.topFixes,
			funnel: result.funnel ?? null,
			ipHash: hashIp(ip),
			ua: (request.headers.get('user-agent') ?? '').slice(0, 160),
			referrer: (request.headers.get('referer') ?? '').slice(0, 200),
		});
		// Fire-and-forget: the visitor should not wait on Slack/email.
		void notify(
			`Tool run: ${tool} on ${result.host} (${result.score}/100)`,
			`URL: ${result.url}\nScore: ${result.score}/100 (${result.grade})\nTop fixes:\n- ${result.topFixes.slice(0, 3).join('\n- ')}`,
			record,
		);
		return json({ ok: true, result });
	} catch (e) {
		if (e instanceof FetchError) return json({ ok: false, error: e.message }, e.code === 'bad_url' || e.code === 'blocked' ? 400 : 422);
		if ((e as { code?: string }).code === 'busy') return json({ ok: false, error: 'The analyser is busy right now. Try again in a few seconds.' }, 503, { 'retry-after': '10' });
		console.error('[analyze] unexpected:', e);
		return json({ ok: false, error: 'Something went wrong while analysing that page.' }, 500);
	}
};
