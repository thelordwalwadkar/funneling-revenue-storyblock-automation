// The lead form in front of the three reports. Submitting it saves the visitor's details (admin dashboard) and returns
// a signed token that unlocks the reports in this browser for 14 days. Built with createElement/textContent only.
import { clear, h } from './core/util.js';

const KEY = 'fr.report-unlock';

function readStored() {
	try {
		const s = JSON.parse(localStorage.getItem(KEY) || 'null');
		if (s && s.token && s.exp > Date.now()) return s;
	} catch {
		/* storage unavailable: the form simply shows again */
	}
	return null;
}
function writeStored(s) {
	try {
		localStorage.setItem(KEY, JSON.stringify(s));
	} catch {
		/* ignore */
	}
}
function forget() {
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* ignore */
	}
}
function expiry(token) {
	try {
		const body = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
		const exp = JSON.parse(atob(body)).exp;
		if (Number.isFinite(exp)) return exp;
	} catch {
		/* fall through */
	}
	return Date.now() + 24 * 3600 * 1000;
}

export const getUnlock = readStored;

/**
 * gate({ tool, onChange }) -> { el, isUnlocked(), token() }
 * onChange(unlock | null) fires when the state changes (and once at the start).
 */
export function createGate({ tool, onChange }) {
	const el = h('section', { class: 'card', 'aria-labelledby': 'gate-h' });
	let state = readStored();

	const field = (id, label, attrs = {}, wide = false) =>
		h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', { for: id }, label, attrs.required ? h('span', { class: 'req' }, ' *') : null), h('input', { id, name: id, ...attrs }));

	function renderForm() {
		const error = h('div', { class: 'gate-error', role: 'alert', hidden: true });
		const submit = h('button', { type: 'submit', class: 'btn' }, 'Unlock the reports');
		const consent = h('input', { type: 'checkbox', id: 'gate-consent', name: 'consent', required: true });
		const form = h('form', { class: 'gate-form', novalidate: true },
			h('div', { class: 'fields' },
				field('name', 'Your name', { type: 'text', required: true, autocomplete: 'name', maxlength: 120 }),
				field('email', 'Work email', { type: 'email', required: true, autocomplete: 'email', maxlength: 200 }),
				field('phone', 'Phone number', { type: 'tel', required: true, autocomplete: 'tel', maxlength: 40, placeholder: '+91 …' }),
				field('company', 'Company', { type: 'text', required: true, autocomplete: 'organization', maxlength: 160 }),
				field('website', 'Website (optional)', { type: 'url', autocomplete: 'url', maxlength: 300, placeholder: 'https://' }),
				field('role', 'Your role (optional)', { type: 'text', autocomplete: 'organization-title', maxlength: 80 }),
				h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { for: 'bot-field' }, 'Leave this empty'), h('input', { id: 'bot-field', name: 'bot-field', type: 'text', tabindex: '-1', autocomplete: 'off' })),
				h('div', { class: 'field check wide' },
					h('label', { for: 'gate-consent' }, consent,
						h('span', null, 'I agree that Funneling Revenue may contact me about my results and its services. Details are used for that only. ', h('a', { href: '/privacy-policy/', target: '_blank', rel: 'noopener' }, 'Privacy policy'), '.'))),
			),
			error,
			h('div', { class: 'btn-row', style: { marginTop: '16px' } }, submit),
		);
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			error.hidden = true;
			const fd = Object.fromEntries(new FormData(form));
			const body = { ...fd, consent: consent.checked, tool: tool.slug };
			if (!consent.checked) {
				error.textContent = 'Please tick the box to agree to be contacted.';
				error.hidden = false;
				return;
			}
			submit.disabled = true;
			submit.textContent = 'Unlocking…';
			try {
				const res = await fetch('/api/report-lead/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
				const j = await res.json().catch(() => ({}));
				if (!res.ok || !j.ok || !j.token) throw new Error(j.error || 'Something went wrong. Please try again.');
				state = { token: j.token, email: String(fd.email || '').toLowerCase(), name: String(fd.name || ''), exp: expiry(j.token) };
				writeStored(state);
				render();
				onChange?.(state);
			} catch (err) {
				error.textContent = err.message;
				error.hidden = false;
				submit.disabled = false;
				submit.textContent = 'Unlock the reports';
			}
		});
		return form;
	}

	function render() {
		clear(el);
		if (state) {
			el.append(
				h('h2', { id: 'gate-h' }, h('span', { class: 'step' }, '✓'), 'Reports unlocked'),
				h('div', { class: 'unlocked' }, h('span', null, `Unlocked for ${state.email}. Internal Link Gap, Index Bloat and Query Clustering stay open on this browser for 14 days.`),
					h('button', { type: 'button', class: 'linklike', onclick: () => { forget(); state = null; render(); onChange?.(null); } }, 'Use different details')),
			);
			return;
		}
		el.append(
			h('h2', { id: 'gate-h' }, h('span', { class: 'step' }, '1'), 'Unlock the report'),
			h('p', { class: 'gate-intro' }, 'This report is free. Leave your details once and Internal Link Gap, Index Bloat and Query Clustering all open for 14 days on this browser.'),
			h('ul', { class: 'gate-points' },
				h('li', null, 'Your Search Console data is read in your browser and is never stored on our servers.'),
				h('li', null, 'We keep your details and the site you analyze, so we can follow up about the results.')),
			renderForm(),
		);
	}

	render();
	queueMicrotask(() => onChange?.(state));
	return { el, isUnlocked: () => !!state, token: () => state?.token || '', unlock: () => state };
}
