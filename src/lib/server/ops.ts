/**
 * Operational plumbing for the API routes: storage, rate limiting, result
 * caching, lead qualification and outbound notifications. Everything is
 * configured through environment variables (see .env.example) and degrades
 * gracefully when a variable is missing, so the site works with zero config.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const env = (k: string) => process.env[k]?.trim() || '';

/* --------------------------------- storage --------------------------------- */

const DATA_DIR = () => path.resolve(env('DATA_DIR') || './data');
const FILE = () => path.join(DATA_DIR(), 'submissions.jsonl');

export interface Submission {
	id: string;
	ts: string;
	kind: 'tool' | 'lead';
	[key: string]: unknown;
}

export async function saveSubmission(entry: Omit<Submission, 'id' | 'ts'>): Promise<Submission> {
	const record = { id: randomUUID(), ts: new Date().toISOString(), ...entry } as Submission;
	try {
		await mkdir(DATA_DIR(), { recursive: true });
		await appendFile(FILE(), JSON.stringify(record) + '\n', 'utf8');
	} catch (e) {
		// Never fail a visitor's request because the disk is read-only; the
		// webhook / email notification below is the durable copy in that case.
		console.error('[store] could not persist submission:', (e as Error).message);
	}
	return record;
}

export async function readSubmissions(limit = 500): Promise<Submission[]> {
	try {
		const raw = await readFile(FILE(), 'utf8');
		return raw
			.split('\n')
			.filter(Boolean)
			.slice(-limit)
			.map((l) => JSON.parse(l))
			.reverse();
	} catch {
		return [];
	}
}

/* ------------------------------ auth + hashing ------------------------------ */

export function isAdmin(request: Request): boolean {
	const token = env('ADMIN_TOKEN');
	if (!token) return false;
	const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
	const a = Buffer.from(given);
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

export const hashIp = (ip: string) =>
	createHash('sha256')
		.update(ip + (env('IP_SALT') || 'funneling-revenue'))
		.digest('hex')
		.slice(0, 16);

export function clientIp(request: Request, fallback?: string): string {
	const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	return fwd || request.headers.get('x-real-ip') || fallback || 'unknown';
}

/* ------------------------------- rate limiting ------------------------------ */

const hits = new Map<string, number[]>();

/** Sliding-window limiter, in memory. Returns seconds to wait, or 0 if allowed. */
export function rateLimit(key: string, max: number, windowMs: number): number {
	const now = Date.now();
	const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
	if (recent.length >= max) {
		hits.set(key, recent);
		return Math.ceil((windowMs - (now - recent[0])) / 1000);
	}
	recent.push(now);
	hits.set(key, recent);
	if (hits.size > 5000) {
		for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
	}
	return 0;
}

/* ----------------------- result cache + concurrency cap ---------------------- */

const cache = new Map<string, { at: number; value: unknown }>();
export function cacheGet<T>(key: string, ttlMs = 10 * 60_000): T | undefined {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
	cache.delete(key);
	return undefined;
}
export function cacheSet(key: string, value: unknown) {
	cache.set(key, { at: Date.now(), value });
	if (cache.size > 300) cache.delete(cache.keys().next().value as string);
}

let active = 0;
export async function withSlot<T>(fn: () => Promise<T>, max = 6): Promise<T> {
	if (active >= max) throw Object.assign(new Error('busy'), { code: 'busy' });
	active++;
	try {
		return await fn();
	} finally {
		active--;
	}
}

/* ------------------------------ lead qualification --------------------------- */

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|live|aol|icloud|proton|protonmail|rediffmail|mail|gmx|yandex)\./i;
const VERTICALS = /(industrial|machinery|equipment|filtration|process|life sciences|lab|construction|heavy|manufactur)/i;

export interface LeadInput {
	name?: string;
	email: string;
	company?: string;
	domain?: string;
	role?: string;
	industry?: string;
	leak?: string;
	goal?: string;
	source?: string;
}

export function qualifyLead(lead: LeadInput, auditScore?: number) {
	let s = 0;
	const why: string[] = [];
	if (!FREE_MAIL.test(lead.email)) {
		s += 25;
		why.push('company email');
	}
	if (/founder|md|owner|ceo|cmo|director|vp|head/i.test(lead.role ?? '')) {
		s += /founder|md|owner|ceo|cmo/i.test(lead.role ?? '') ? 20 : 15;
		why.push(`decision-maker role (${lead.role})`);
	}
	if (VERTICALS.test(lead.industry ?? '')) {
		s += 20;
		why.push('target industry');
	} else if (lead.industry) s += 5;
	if (lead.domain) s += 5;
	if (auditScore !== undefined) {
		s += auditScore < 50 ? 25 : auditScore < 75 ? 15 : 5;
		why.push(`site scored ${auditScore}/100`);
	}
	if ((lead.goal ?? '').length > 40) {
		s += 10;
		why.push('detailed goal');
	}
	const tier = s >= 70 ? 'hot' : s >= 45 ? 'warm' : 'cold';
	const action =
		tier === 'hot'
			? 'Reply personally within 4 business hours and offer a call slot.'
			: tier === 'warm'
				? 'Reply within one business day with the audit summary and a call link.'
				: 'Send the automated audit summary and add to the nurture list.';
	return { score: Math.min(100, s), tier, action, why };
}

/* -------------------------------- notifications ----------------------------- */

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 6000);
	try {
		const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
		if (!r.ok) console.error(`[notify] ${new URL(url).host} -> ${r.status}`);
	} catch (e) {
		console.error('[notify] failed:', (e as Error).message);
	} finally {
		clearTimeout(t);
	}
}

/** Sends a submission to every configured channel. Never throws. */
export async function notify(subject: string, text: string, record: Submission) {
	const jobs: Promise<void>[] = [];
	const hook = env('WEBHOOK_URL');
	if (hook) {
		// `text` is read by Slack / Mattermost / Zapier, `content` by Discord; the full record rides along.
		jobs.push(post(hook, { text: `*${subject}*\n${text}`, content: `**${subject}**\n${text}`, record }));
	}
	const key = env('RESEND_API_KEY');
	const to = env('NOTIFY_EMAIL');
	if (key && to) {
		jobs.push(
			post(
				'https://api.resend.com/emails',
				{ from: env('MAIL_FROM') || 'Funneling Revenue <onboarding@resend.dev>', to: to.split(',').map((s) => s.trim()), subject, text },
				{ authorization: `Bearer ${key}` },
			),
		);
	}
	await Promise.allSettled(jobs);
}
