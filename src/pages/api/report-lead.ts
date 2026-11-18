import type { APIRoute } from 'astro';
import { clientIp, hashIp, notify, qualifyLead, rateLimit, saveSubmission, type LeadInput } from '../../lib/server/ops';
import { makeUnlockToken } from '../../lib/server/reports';

export const prerender = false;

const REPORTS = ['internal-link-gap', 'index-bloat', 'query-clustering'];

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const clean = (v: unknown, max = 300) =>
	String(v ?? '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
		.trim()
		.slice(0, max);

/**
 * POST /api/report-lead/ is the gate in front of the three reports. The visitor leaves their details; they get back a
 * signed token that unlocks the reports in their browser for 14 days. The details land in the admin dashboard.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
	let raw: Record<string, unknown>;
	const type = request.headers.get('content-type') ?? '';
	try {
		raw = type.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
	} catch {
		return json({ ok: false, error: 'Could not read the form.' }, 400);
	}
	if (clean(raw['bot-field'])) return json({ ok: true, token: '' }); // honeypot: pretend success

	const ip = clientIp(request, clientAddress);
	if (rateLimit(`reportlead:${ip}`, 10, 60 * 60_000)) return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);

	const name = clean(raw.name, 120);
	const email = clean(raw.email, 200).toLowerCase();
	const phone = clean(raw.phone, 40);
	const company = clean(raw.company, 160);
	if (name.length < 2) return json({ ok: false, error: 'Please enter your name.' }, 400);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
	if (phone.replace(/\D/g, '').length < 7 || !/^[+\d][\d\s().-]{5,}$/.test(phone)) return json({ ok: false, error: 'Please enter a phone number we can reach you on.' }, 400);
	if (company.length < 2) return json({ ok: false, error: 'Please enter your company name.' }, 400);
	if (!(raw.consent === true || raw.consent === 'true' || raw.consent === 'on')) return json({ ok: false, error: 'Please tick the box to agree to be contacted.' }, 400);

	const tool = clean(raw.tool, 60);
	const lead: LeadInput = {
		name,
		email,
		company,
		domain: clean(raw.website, 300),
		role: clean(raw.role, 80),
		source: REPORTS.includes(tool) ? `report:${tool}` : 'report',
	};
	const q = qualifyLead(lead);
	const record = await saveSubmission({
		kind: 'report-lead',
		...lead,
		phone,
		tool: REPORTS.includes(tool) ? tool : '',
		qualification: q,
		ipHash: hashIp(ip),
		ua: (request.headers.get('user-agent') ?? '').slice(0, 160),
	});

	await notify(
		`${q.tier.toUpperCase()} report lead: ${name} (${company})`,
		[
			`Email: ${email}`,
			`Phone: ${phone}`,
			lead.role && `Role: ${lead.role}`,
			lead.domain && `Website: ${lead.domain}`,
			tool && `Asked for: ${tool}`,
			`Priority: ${q.tier} (${q.score}/100; ${q.why.join(', ') || 'no signals'})`,
			`Next step: ${q.action}`,
		]
			.filter(Boolean)
			.join('\n'),
		record,
	);

	return json({ ok: true, token: makeUnlockToken(record.id, email) });
};
