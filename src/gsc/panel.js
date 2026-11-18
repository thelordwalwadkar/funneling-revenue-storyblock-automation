// "Connect Search Console" panel: Google sign-in, property picker, and an optional sample-data mode.
// Search Console data goes from Google straight into this browser tab. We never see the Google access token.
import { generateDemoRows } from './core/demo.js';
import { getProfile, getToken, listSites, signIn, signOut } from './core/gsc.js';
import { sampleExtraRows, sampleReportApi } from './core/sample-site.js';
import { GscSource, MemorySource } from './core/sources.js';
import { notice } from './core/ui.js';
import { clear, h, monthLabel } from './core/util.js';

const LS_SITE = 'fr.gsc-site';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };


export function createAccessPanel({ config, tool, step = 1, today = new Date(), onChange }) {
	let source = null;
	let anchor = null;
	let sampleApi = null;
	const identity = { email: '', name: '', property: '' };

	const body = h('div');
	const status = h('div', { 'aria-live': 'polite' });
	const el = h('section', { class: 'card', 'aria-labelledby': 'src-h' }, h('h2', { id: 'src-h' }, h('span', { class: 'step' }, String(step)), 'Connect Search Console'), body, status);

	function setSource(s, { property = '' } = {}) {
		source = s;
		identity.property = property;
		anchor = s ? s.defaultAnchor() : null;
		renderStatus();
		onChange?.(source);
	}

	function renderStatus() {
		clear(status);
		if (!source) return;
		const months = source.months();
		const sel = h('select', { 'aria-label': 'Analyze up to', onchange: (e) => { anchor = e.target.value; } },
			[...months].reverse().map((m) => h('option', { value: m, selected: m === anchor }, monthLabel(m))));
		status.append(
			h('div', { class: 'notice ok' },
				h('strong', null, 'Ready: '),
				source.kind === 'demo' ? [h('span', { class: 'demo-badge' }, 'Sample'), ' '] : null,
				source.label,
				source.kind === 'gsc' ? ' · live from Google (read-only)' : ' · made-up data, nothing is sent anywhere',
				h('div', { class: 'btn-row', style: { marginTop: '8px' } }, h('label', { class: 'small', for: 'anchor-sel' }, 'Analyze up to (last full month): '), Object.assign(sel, { id: 'anchor-sel', style: 'width:auto' }))),
		);
	}

	// ---------------------------------------------------------------- not connected
	function renderConnect(message) {
		clear(body);
		body.append(
			h('div', { class: 'connect' },
				h('p', { style: { margin: 0 } }, 'Sign in with the Google account that has access to your site in Search Console, then pick the property to analyze.'),
				h('ul', { class: 'connect-points' },
					h('li', null, 'Read-only access: the tool can look at your data but can never change anything.'),
					h('li', null, 'Your Search Console data goes from Google straight to this browser tab and is not stored on our servers.'),
					h('li', null, 'We do record your Google email, the property you analyze and which tool you ran, so we can follow up about the results.')),
				message ? notice('error', message) : null,
				config.googleClientId
					? h('button', { type: 'button', class: 'btn', onclick: async (e) => {
						e.currentTarget.disabled = true;
						try {
							await signIn(config.googleClientId);
							await loadSites();
						} catch (err) {
							renderConnect(err.message);
						}
					} }, 'Sign in with Google')
					: notice('warn', h('strong', null, 'Google sign-in is not switched on for this site yet. '), 'You can still look around with the sample data below.'),
				h('button', { type: 'button', class: 'linklike', onclick: useSample }, 'Or see it with sample data first'),
			),
		);
	}

	// ---------------------------------------------------------------- signed in
	async function loadSites() {
		clear(body);
		body.append(h('p', { class: 'muted' }, 'Loading your Search Console properties…'));
		try {
			const [profile, sites] = await Promise.all([getProfile(), listSites()]);
			identity.email = profile?.email || '';
			identity.name = profile?.name || '';
			clear(body);
			const signOutBtn = h('button', { type: 'button', class: 'linklike', onclick: () => { signOut(); identity.email = ''; identity.name = ''; setSource(null); renderConnect(); } }, 'Use a different account');
			if (!sites.length) {
				body.append(notice('warn', 'This Google account has no Search Console properties it can read. Try another account.'), signOutBtn);
				return;
			}
			const saved = lsGet(LS_SITE);
			const sel = h('select', { id: 'gsc-site', 'aria-label': 'Search Console property' }, sites.map((s) => h('option', { value: s.siteUrl, selected: s.siteUrl === saved }, s.siteUrl)));
			body.append(
				h('div', { class: 'who' }, h('span', null, 'Signed in as ', h('b', null, identity.email || 'your Google account')), signOutBtn),
				h('div', { class: 'field' }, h('label', { for: 'gsc-site' }, 'Property'), sel),
				h('div', { class: 'btn-row', style: { marginTop: '12px' } },
					h('button', { type: 'button', class: 'btn', onclick: () => { lsSet(LS_SITE, sel.value); setSource(new GscSource({ siteUrl: sel.value, today }), { property: sel.value }); } }, 'Use this property')),
			);
			if (saved && sites.some((s) => s.siteUrl === saved) && !source) setSource(new GscSource({ siteUrl: saved, today }), { property: saved });
		} catch (err) {
			renderConnect(err.message);
		}
	}

	// ---------------------------------------------------------------- sample
	function useSample() {
		const probe = new MemorySource([], { today });
		const anchorMonth = probe.defaultAnchor();
		const clean = generateDemoRows({ anchorMonth });
		const rows = tool?.slug === 'index-bloat' ? [...clean, ...sampleExtraRows(anchorMonth)] : clean; // the junk URLs only matter to Index Bloat
		sampleApi = sampleReportApi(clean);
		setSource(new MemorySource(rows, { kind: 'demo', label: 'acmefit.example (made-up site)', today }));
	}

	if (getToken()) loadSites();
	else renderConnect();

	return {
		el,
		getSource: () => source,
		getAnchor: () => anchor,
		getIdentity: () => ({ ...identity }),
		getSampleApi: () => sampleApi,
	};
}
