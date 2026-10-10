import type { APIRoute } from 'astro';
import { analyze } from '../../lib/server/analyze';
import { clientIp, hashIp, notify, qualifyLead, rateLimit, saveSubmission, type LeadInput } from '../../lib/server/ops';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const clean = (v: unknown, max = 500) =>
	String(v ?? '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
		.trim()
		.slice(0, max);

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let raw: Record<string, unknown>;
	const type = request.headers.get('content-type') ?? '';
	try {
		raw = type.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
	} catch {
		return json({ ok: false, error: 'Could not read the form.' }, 400);
	}

	// Honeypot: bots fill it, people never see it. Pretend success.
	if (clean(raw['bot-field'])) return json({ ok: true });

	const ip = clientIp(request, clientAddress);
	if (rateLimit(`lead:${ip}`, 5, 60 * 60_000)) return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);

	const lead: LeadInput = {
		name: clean(raw.name, 120),
		email: clean(raw.email, 200).toLowerCase(),
		company: clean(raw.company, 160),
		domain: clean(raw.domain ?? raw.url, 300),
		role: clean(raw.role, 80),
		industry: clean(raw.industry, 120),
		leak: clean(raw.leak, 80),
		goal: clean(raw.goal, 1500),
		source: clean(raw.source, 120) || 'audit-form',
	};
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);

	// "Take the decisions yourself": if a website was given, audit it now so the
	// lead arrives with a diagnosis and a priority tier attached.
	let audit: { score: number; grade: string; topFixes: string[]; funnel?: unknown } | undefined;
	if (lead.domain) {
		try {
			const a = await Promise.race([
				analyze('audit', lead.domain),
				new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 14000)),
			]);
			audit = { score: a.score, grade: a.grade, topFixes: a.topFixes, funnel: a.funnel };
		} catch {
			/* an unreachable site is itself useful context; carry on */
		}
	}

	const q = qualifyLead(lead, audit?.score);
	const record = await saveSubmission({
		kind: 'lead',
		...lead,
		audit: audit ?? null,
		qualification: q,
		ipHash: hashIp(ip),
		ua: (request.headers.get('user-agent') ?? '').slice(0, 160),
	});

	await notify(
		`${q.tier.toUpperCase()} lead: ${lead.name || lead.email}${lead.company ? ` (${lead.company})` : ''}`,
		[
			`Email: ${lead.email}`,
			lead.role && `Role: ${lead.role}`,
			lead.industry && `Industry: ${lead.industry}`,
			lead.domain && `Site: ${lead.domain}${audit ? ` -> ${audit.score}/100` : ''}`,
			lead.leak && `Suspected leak: ${lead.leak}`,
			lead.goal && `Goal: ${lead.goal}`,
			`Priority: ${q.tier} (${q.score}/100; ${q.why.join(', ') || 'no signals'})`,
			`Next step: ${q.action}`,
			audit?.topFixes?.length ? `Top fixes found:\n- ${audit.topFixes.slice(0, 3).join('\n- ')}` : '',
		]
			.filter(Boolean)
			.join('\n'),
		record,
	);

	return json({ ok: true, id: record.id, audit: audit ? { score: audit.score, grade: audit.grade } : null });
};
