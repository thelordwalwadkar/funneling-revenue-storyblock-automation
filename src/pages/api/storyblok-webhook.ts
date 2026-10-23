import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rateLimit } from '../../lib/server/ops';

export const prerender = false;

const env = (k: string) => process.env[k]?.trim() || '';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Storyblok -> site automation.
 *
 * In Storyblok: Settings -> Webhooks -> add https://<your-domain>/api/storyblok-webhook/
 * for "Story published / unpublished / moved / deleted", with a secret that you
 * also set here as STORYBLOK_WEBHOOK_SECRET.
 *
 * On a valid event this either:
 *   - fires a GitHub repository_dispatch (GITHUB_TOKEN + GITHUB_REPO), which runs
 *     .github/workflows/storyblok-pull.yml: it pulls the edited content back
 *     into src/content/, commits it, and your host redeploys on that push; and/or
 *   - POSTs DEPLOY_HOOK_URL (Render / Netlify / Vercel / Railway deploy hook).
 */
export const POST: APIRoute = async ({ request }) => {
	const secret = env('STORYBLOK_WEBHOOK_SECRET');
	if (!secret) return json({ ok: false, error: 'STORYBLOK_WEBHOOK_SECRET is not configured.' }, 503);

	const raw = await request.text();
	const sig = request.headers.get('webhook-signature') ?? '';
	const expected = createHmac('sha1', secret).update(raw).digest('hex');
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ ok: false, error: 'Bad signature' }, 401);

	// Editors often publish several stories at once; collapse bursts into one run.
	if (rateLimit('storyblok-webhook', 1, 30_000)) return json({ ok: true, skipped: 'debounced' });

	let event: { action?: string; full_slug?: string } = {};
	try {
		event = JSON.parse(raw);
	} catch {
		/* signature was valid; carry on with an empty event */
	}

	const triggered: string[] = [];
	const token = env('GITHUB_TOKEN');
	const repo = env('GITHUB_REPO');
	if (token && repo) {
		const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'funneling-revenue-site' },
			body: JSON.stringify({ event_type: 'storyblok-publish', client_payload: { action: event.action, slug: event.full_slug } }),
		}).catch(() => null);
		if (r?.ok) triggered.push('github');
		else console.error('[storyblok-webhook] GitHub dispatch failed:', r?.status);
	}
	const hook = env('DEPLOY_HOOK_URL');
	if (hook) {
		const r = await fetch(hook, { method: 'POST' }).catch(() => null);
		if (r?.ok) triggered.push('deploy-hook');
		else console.error('[storyblok-webhook] deploy hook failed');
	}
	return json({ ok: true, triggered });
};
