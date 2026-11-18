import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * GET /api/gsc-config/ tells the Search Console tool pages which Google sign-in to use.
 * The OAuth client ID is public by design (it is sent to every visitor's browser), so it is read at run time from
 * GOOGLE_CLIENT_ID. Setting it in the host's environment switches sign-in on without rebuilding the site.
 */
export const GET: APIRoute = () =>
	new Response(JSON.stringify({ clientId: (process.env.GOOGLE_CLIENT_ID ?? '').trim() }), {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
