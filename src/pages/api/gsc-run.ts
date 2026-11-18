import type { APIRoute } from 'astro';
import { clientIp, hashIp, notify, rateLimit, saveSubmission } from '../../lib/server/ops';
import { readUnlockToken } from '../../lib/server/reports';

export const prerender = false;

const TOOLS = [
	'content-decay',
	'keyword-cannibalization',
	'striking-distance',
	'keyword-growth',
	'loss-detector',
	'internal-link-gap',
	'index-bloat',
	'query-clustering',
];

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const clean = (v: unknown, max = 300) =>
	String(v ?? '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
		.trim()
		.slice(0, max);

/** Keeps a small settings or result summary: flat, short values only. */
function flat(v: unknown): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	if (!v || typeof v !== 'object') return out;
	for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 24)) {
		if (typeof val === 'number' && Number.isFinite(val)) out[clean(k, 40)] = val;
		else if (typeof val === 'boolean') out[clean(k, 40)] = val;
		else if (typeof val === 'string') out[clean(k, 40)] = clean(val, 120);
		else if (Array.isArray(val)) out[clean(k, 40)] = clean(val.join(', '), 120);
	}
	return out;
}

/**
 * POST /api/gsc-run/ records that someone ran a Search Console tool: which tool, which property, and the Google
 * account that signed in. It never receives Search Console rows or Google access tokens.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
	let raw: Record<string, unknown>;
	try {
		raw = await request.json();
	} catch {
		return json({ ok: false, error: 'Send a JSON body.' }, 400);
	}
	const ip = clientIp(request, clientAddress);
	if (rateLimit(`gscrun:${ip}`, 80, 60 * 60_000)) return json({ ok: false, error: 'Too many requests.' }, 429);

	const tool = clean(raw.tool, 60);
	if (!TOOLS.includes(tool)) return json({ ok: false, error: 'Unknown tool.' }, 400);
	const property = clean(raw.property, 300);
	if (!property) return json({ ok: false, error: 'Missing property.' }, 400);
	const email = clean(raw.email, 200).toLowerCase();
	const lead = readUnlockToken(clean(raw.token, 600));

	const record = await saveSubmission({
		kind: 'gsc',
		tool,
		property,
		host: property.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
		email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : '',
		name: clean(raw.name, 120),
		leadId: lead?.id ?? '',
		settings: flat(raw.settings),
		result: flat(raw.result),
		ipHash: hashIp(ip),
		ua: (request.headers.get('user-agent') ?? '').slice(0, 160),
	});

	await notify(
		`Search Console tool run: ${tool}`,
		[`Property: ${property}`, email && `Google account: ${email}${record.name ? ` (${record.name})` : ''}`, lead && `Report lead: ${lead.email}`].filter(Boolean).join('\n'),
		record,
	);
	return json({ ok: true, id: record.id });
};
