// Interactive part of every Search Console tool page: connect, (unlock), settings, run, results.
// The page around it (headings, explanation, FAQ) is static HTML from the Astro page, so search engines and visitors
// without JavaScript still get the content.
import { buildForm } from './core/form.js';
import { getToken, inspectUrl, signIn } from './core/gsc.js';
import { notice } from './core/ui.js';
import { clear, h } from './core/util.js';
import { createGate } from './gate.js';
import { createAccessPanel } from './panel.js';
import { LOADERS, RUN_LABEL } from './registry.js';

async function loadConfig() {
	try {
		const res = await fetch('/api/gsc-config/', { cache: 'no-store' });
		const j = await res.json();
		return { googleClientId: String(j.clientId || ''), api: '' };
	} catch {
		return { googleClientId: '', api: '' };
	}
}

/** Short, flat copy of the settings for the admin log. */
function flatSettings(values) {
	const out = {};
	for (const [k, v] of Object.entries(values)) {
		const value = Array.isArray(v) ? v.join(', ') : v;
		if (value == null || value === '') continue;
		out[k] = value;
	}
	return out;
}

/** Tell the backend which tool was run on which property by which Google account. Never blocks the run. */
function logRun({ tool, identity, settings, unlock }) {
	try {
		fetch('/api/gsc-run/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			keepalive: true,
			body: JSON.stringify({ tool: tool.slug, property: identity.property, email: identity.email, name: identity.name, token: unlock?.token || '', settings: flatSettings(settings) }),
		}).catch(() => {});
	} catch {
		/* logging must never break a run */
	}
}

/** The report API for a real site: the server reads the sitemap and pages; Google answers URL Inspection. */
function liveReportApi(source, token) {
	const call = async (body) => {
		const res = await fetch('/api/report-crawl/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, site: source.siteUrl, ...body }) });
		const j = await res.json().catch(() => ({}));
		if (!res.ok || !j.ok) throw new Error(j.error || `The checker returned HTTP ${res.status}.`);
		return j;
	};
	return {
		kind: 'live',
		sitemap: () => call({ action: 'sitemap' }),
		pages: async (urls) => (await call({ action: 'pages', urls })).pages,
		inspect: (url) => inspectUrl(source.siteUrl, url),
	};
}

export async function start(root) {
	const toolId = root.dataset.tool;
	const loader = LOADERS[toolId];
	if (!loader) {
		clear(root).append(notice('error', 'This tool is not available.'));
		return;
	}
	const [tool, config] = await Promise.all([loader(), loadConfig()]);
	mountTool(root, tool, config);
}

export function mountTool(root, tool, config) {
	const today = new Date();
	const gated = !!tool.gated;
	const runLabel = tool.runLabel || RUN_LABEL[tool.slug] || 'Run';

	const results = h('div', { id: 'results', 'aria-live': 'polite' });
	const log = h('div', { class: 'log', hidden: true });
	const hint = h('span', { class: 'muted small' });
	const runBtn = h('button', { type: 'button', class: 'btn run', disabled: true, onclick: run }, runLabel);

	let unlock = null;
	const refreshRun = () => {
		const ready = !!panel.getSource() && (!gated || !!unlock);
		runBtn.disabled = !ready;
		hint.textContent = ready ? '' : gated && !unlock ? 'Unlock the report first.' : 'Connect Search Console first.';
	};

	const gate = gated ? createGate({ tool, onChange: (u) => { unlock = u; refreshRun(); } }) : null;
	const panel = createAccessPanel({ config, tool, step: gated ? 2 : 1, today, onChange: refreshRun });
	const form = buildForm(tool.settings || []);

	const rules = (tool.rules || []).length
		? h('details', { class: 'rules' }, h('summary', null, 'How it decides (fixed rules: the same data always gives the same answer)'), h('ul', null, tool.rules.map((r) => h('li', null, r))))
		: null;
	const step = (n) => String(n + (gated ? 1 : 0));

	clear(root).append(...[
		gate?.el,
		panel.el,
		h('section', { class: 'card' }, h('h2', null, h('span', { class: 'step' }, step(2)), 'Set it up'), form.el, rules),
		h('section', { class: 'card' }, h('h2', null, h('span', { class: 'step' }, step(3)), 'Run it'), h('div', { class: 'run-row' }, runBtn, hint, log)),
		results,
	].filter(Boolean));
	refreshRun();

	const say = (msg) => {
		log.hidden = false;
		log.textContent = msg;
	};

	async function run() {
		const src = panel.getSource();
		if (!src) return;
		clear(results);
		if (gated && !unlock) {
			results.append(notice('error', 'Please unlock the report first with the short form above.'));
			return;
		}
		runBtn.disabled = true;
		const started = performance.now();
		try {
			if (src.kind === 'gsc' && !getToken()) await signIn(config.googleClientId);
			const settings = form.values();
			const anchor = panel.getAnchor();
			say('Starting…');
			if (src.kind === 'gsc') logRun({ tool, identity: panel.getIdentity(), settings, unlock });
			const reportApi = src.kind === 'demo' ? panel.getSampleApi() : liveReportApi(src, unlock?.token || '');
			const ctx = { source: src, settings, anchor, today, config, log: say, reportApi };
			const result = await tool.run(ctx);
			say(`Done in ${((performance.now() - started) / 1000).toFixed(1)}s.`);
			results.append(
				src.kind === 'demo' ? notice('warn', h('span', { class: 'demo-badge' }, 'Sample'), ' These results come from made-up data, not a real site.') : null,
				tool.render(result, ctx),
			);
			results.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} catch (err) {
			console.error(err);
			log.hidden = true;
			results.append(notice('error', err.message || String(err)));
		} finally {
			refreshRun();
		}
	}
	return { panel, form, gate };
}
