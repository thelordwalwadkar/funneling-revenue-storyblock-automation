import type { APIRoute } from 'astro';
import { isAdmin, readSubmissions } from '../../lib/server/ops';

export const prerender = false;

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

/** GET /api/submissions with `Authorization: Bearer <ADMIN_TOKEN>` (add ?format=csv for a spreadsheet). */
export const GET: APIRoute = async ({ request, url }) => {
	if (!isAdmin(request)) {
		return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
	}
	const limit = Math.min(Number(url.searchParams.get('limit')) || 500, 5000);
	const rows = await readSubmissions(limit);
	if (url.searchParams.get('format') === 'csv') {
		const cols = ['ts', 'kind', 'tool', 'host', 'score', 'name', 'email', 'company', 'domain', 'role', 'industry', 'leak', 'goal'];
		const body = [cols.join(','), ...rows.map((r: any) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
		return new Response(body, {
			headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="submissions.csv"' },
		});
	}
	return new Response(JSON.stringify({ ok: true, count: rows.length, rows }), {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
};
