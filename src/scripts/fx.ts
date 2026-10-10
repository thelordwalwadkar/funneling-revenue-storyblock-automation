/**
 * Site-wide interaction layer: scroll progress, reveal-on-scroll, animated
 * counters, pointer spotlight on cards, magnetic buttons, sticky-header state
 * and rotating hero words. Everything is progressive enhancement: with JS off
 * or `prefers-reduced-motion` the page shows its final state.
 */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

/* Scroll progress + header state */
const bar = document.createElement('div');
bar.className = 'scroll-progress';
bar.setAttribute('aria-hidden', 'true');
document.body.prepend(bar);
const header = document.querySelector('.site-header');
let ticking = false;
const onScroll = () => {
	if (ticking) return;
	ticking = true;
	requestAnimationFrame(() => {
		const max = root.scrollHeight - innerHeight;
		bar.style.setProperty('--progress', String(max > 0 ? Math.min(1, scrollY / max) : 0));
		header?.classList.toggle('scrolled', scrollY > 8);
		ticking = false;
	});
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Counters: "225%", "₹3Cr+", "4,000+", "2×" all count up while keeping their affixes */
function countUp(el: HTMLElement) {
	if (el.dataset.counted) return;
	el.dataset.counted = '1';
	const original = el.textContent ?? '';
	const m = original.match(/^([^\d]*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
	if (!m || reduced) return;
	const [, pre, num, post] = m;
	const decimals = (num.split('.')[1] ?? '').length;
	const target = parseFloat(num.replace(/,/g, ''));
	const hasComma = num.includes(',');
	const t0 = performance.now();
	const dur = 1500;
	const fmt = (v: number) =>
		hasComma
			? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
			: v.toFixed(decimals);
	const step = (now: number) => {
		const p = Math.min(1, (now - t0) / dur);
		const eased = 1 - Math.pow(1 - p, 3);
		el.textContent = `${pre}${fmt(target * eased)}${post}`;
		if (p < 1) requestAnimationFrame(step);
		else el.textContent = original;
	};
	requestAnimationFrame(step);
}

/* Reveal + counters share one observer */
const io = new IntersectionObserver(
	(entries) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			const el = e.target as HTMLElement;
			el.classList.add('is-in');
			if (el.hasAttribute('data-count')) countUp(el);
			el.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
			io.unobserve(el);
		}
	},
	{ threshold: 0.08, rootMargin: '0px 0px -4% 0px' },
);
document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
	const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal')) : [];
	el.style.setProperty('--i', String(Math.min(siblings.indexOf(el), 6)));
	io.observe(el);
});
document.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
	if (!el.closest('[data-reveal]')) io.observe(el);
});

/* Pointer effects (fine pointers only) */
if (window.matchMedia('(pointer: fine)').matches && !reduced) {
	document.addEventListener(
		'pointermove',
		(e) => {
			const spot = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.card, .spot');
			if (spot) {
				const r = spot.getBoundingClientRect();
				spot.style.setProperty('--mx', `${e.clientX - r.left}px`);
				spot.style.setProperty('--my', `${e.clientY - r.top}px`);
			}
		},
		{ passive: true },
	);
	const magnets = [...document.querySelectorAll<HTMLElement>('.btn-accent, .btn-primary')];
	addEventListener(
		'pointermove',
		(e) => {
			for (const b of magnets) {
				const r = b.getBoundingClientRect();
				if (r.bottom < -150 || r.top > innerHeight + 150) continue;
				const dx = e.clientX - (r.left + r.width / 2);
				const dy = e.clientY - (r.top + r.height / 2);
				const near = Math.hypot(dx, dy) < Math.max(r.width, 120) * 0.8;
				b.style.setProperty('--tx', near ? `${Math.max(-6, Math.min(6, dx * 0.12))}px` : '0px');
				b.style.setProperty('--ty', near ? `${Math.max(-5, Math.min(5, dy * 0.18))}px` : '0px');
			}
		},
		{ passive: true },
	);
}

/* Rotating words: <span data-rotate="pipeline|revenue|citations"> */
document.querySelectorAll<HTMLElement>('[data-rotate]').forEach((el) => {
	const words = (el.dataset.rotate ?? '').split('|').filter(Boolean);
	if (words.length < 2 || reduced) return;
	el.style.transition = 'opacity 280ms ease, transform 280ms ease';
	let i = 0;
	setInterval(() => {
		el.style.opacity = '0';
		el.style.transform = 'translateY(8px)';
		setTimeout(() => {
			i = (i + 1) % words.length;
			el.textContent = words[i];
			el.style.opacity = '1';
			el.style.transform = 'none';
		}, 280);
	}, 2400);
});
