// Synthetic demo data for a made-up fitness-gear site ("acmefit"). Deterministic for a given anchor month.
// It is shaped so every tool has something to show: each decay verdict, every cannibalization priority,
// striking-distance candidates, and growth/loss queries of every cause (plus an internal shift).
import { benchmarkCtr } from '../engines/striking.js';
import { addMonths, monthsBetween } from './util.js';

export const DEMO_SITE = 'https://www.acmefit.example';
export const DEMO_BRAND = 'acmefit';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SLICES = [
  { country: 'usa', device: 'mobile', share: 0.42 },
  { country: 'usa', device: 'desktop', share: 0.28 },
  { country: 'gbr', device: 'mobile', share: 0.18 },
  { country: 'ind', device: 'desktop', share: 0.12 },
];
const MODS = ['best', 'review', 'vs', 'for beginners', 'how to use', 'size guide', 'benefits', 'cheap', 'workout', 'buying guide', 'setup', 'alternatives'];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (k, k0, k1, v0, v1) => v0 + (v1 - v0) * clamp01((k - k0) / (k1 - k0));
const val = (v, k) => (typeof v === 'function' ? v(k) : v);

export function generateDemoRows({ anchorMonth, seed = 7 } = {}) {
  if (!anchorMonth) throw new Error('anchorMonth is required');
  const rand = mulberry32(seed);
  const months = monthsBetween(addMonths(anchorMonth, -17), anchorMonth); // 18 months, k = -17 .. 0
  const entries = [];
  const add = (path, query, o) => entries.push({ page: `${DEMO_SITE}${path}`, query, ...o });
  const vol = (i) => Math.round(5200 / (1 + i * 0.9) * (0.8 + rand() * 0.4)); // first query of a page is the biggest

  // --- Page archetypes (decay tool) ---------------------------------------------------------
  const archetypes = {
    stable: { n: 6, pages: [['best-rowing-machines', 'rowing machine'], ['standing-desk-guide', 'standing desk'], ['yoga-mat-buying-guide', 'yoga mat'], ['kettlebell-weights-explained', 'kettlebell'], ['foam-roller-benefits', 'foam roller'], ['resistance-bands-workouts', 'resistance bands']], impr: () => 1 },
    growing: { n: 6, pages: [['treadmill-vs-walking-pad', 'treadmill'], ['protein-powder-guide', 'protein powder'], ['sleep-tracker-review', 'sleep tracker'], ['water-bottle-sizes', 'water bottle']], impr: (k) => lerp(k, -17, 0, 0.5, 1.7) },
    seasonal: { n: 6, pages: [['summer-running-tips', 'running shoes'], ['hiking-gear-checklist', 'hiking backpack'], ['swimming-workouts', 'swim goggles']], impr: (k) => 1 + 0.8 * Math.cos((2 * Math.PI * (k + 6)) / 12) },
    refresh: { n: 6, pages: [['home-gym-ideas-2024', 'home gym'], ['best-dumbbells-2023', 'dumbbells'], ['pull-up-bar-roundup', 'pull up bar'], ['fitness-trackers-compared', 'fitness tracker']], impr: (k) => (k <= -10 ? 1 : Math.pow(0.88, k + 10)) },
    ctrfix: { n: 6, pages: [['jump-rope-guide', 'jump rope'], ['exercise-bike-faq', 'exercise bike'], ['gym-bag-checklist', 'gym bag']], impr: () => 1, ctr: (k) => (k <= -8 ? 1 : Math.max(0.35, 1 - 0.08 * (k + 8))) },
    tiny: { n: 2, pages: [['grip-strength-trainers', 'grip trainer'], ['ab-wheel-notes', 'ab wheel'], ['balance-board-faq', 'balance board'], ['wrist-wraps-guide', 'wrist wraps']], impr: () => 0.01 },
    mild: { n: 6, pages: [['pilates-ring-guide', 'pilates ring'], ['massage-gun-review', 'massage gun'], ['workout-playlist-tips', 'workout playlist']], impr: (k) => (k >= -2 ? 0.88 : 1) },
  };
  for (const [type, a] of Object.entries(archetypes)) {
    for (const [slug, topic] of a.pages) {
      for (let i = 0; i < a.n; i++) {
        const q = i === 0 ? topic : `${MODS[(i * 3 + slug.length) % MODS.length]} ${topic}`;
        const base = vol(i) * (type === 'seasonal' ? 0.9 : 1);
        const pos = 3.5 + (i * 7 + slug.length) % 9; // 3.5 .. 11.5, spread across page one / top of page two
        add(`/blog/${slug}`, q, { impr: (k) => base * a.impr(k), pos, ctr: a.ctr });
      }
    }
  }

  // --- Cannibalization groups ----------------------------------------------------------------
  const conflicts = [
    { q: 'best rowing machine', impr: 18000, pages: [['/blog/best-rowing-machines', 5.2], ['/products/rowing-machines', 6.4]] },
    { q: 'standing desk for home office', impr: 12000, pages: [['/blog/standing-desk-guide', 7.1], ['/blog/home-office-setup', 8.0], ['/products/standing-desks', 9.5]] },
    { q: 'yoga mat thickness', impr: 9000, flip: true, pages: [['/blog/yoga-mat-buying-guide', 5], ['/products/yoga-mats', 11]] },
    { q: 'kettlebell weight chart', impr: 8000, pages: [['/blog/kettlebell-weights-explained', 2.4], ['/products/kettlebells', 14]] },
    { q: 'foam roller exercises', impr: 7000, pages: [['/blog/foam-roller-benefits', 4], ['/blog/resistance-bands-workouts', 9.5]] },
    { q: 'resistance band sets', impr: 6000, pages: [['/products/resistance-bands', 3.2], ['/blog/resistance-bands-workouts', 13]] },
    { q: 'protein powder for women', impr: 5000, pages: [['/blog/protein-powder-guide', 6.2], ['/products/protein', 7.5]] },
    { q: 'walking pad vs treadmill', impr: 4200, pages: [['/blog/treadmill-vs-walking-pad', 3.8], ['/products/treadmills', 11.4]] },
    { q: 'smart water bottle', impr: 3000, pages: [['/blog/water-bottle-sizes', 4.4], ['/products/bottles', 10]] },
    { q: 'micro loop bands', impr: 70, pages: [['/blog/resistance-bands-workouts', 8], ['/products/resistance-bands', 12]] }, // low-traffic section
    { q: 'workout recovery routine', impr: 2500, pages: [['/blog/massage-gun-review', 5.5], ['/blog/foam-roller-benefits', 8.5], ['/blog/pilates-ring-guide', 12]] },
  ];
  for (const c of conflicts) {
    c.pages.forEach(([path, p0], pi) => {
      const flipPos = (k) => (c.flip ? (((k + pi) % 2) + 2) % 2 === 0 ? 5 : 11 : p0);
      add(path, c.q, { impr: c.impr * (pi === 0 ? 1 : 0.8), pos: flipPos });
    });
  }

  // --- Striking distance ----------------------------------------------------------------------
  const striking = [
    ['rowing machine for home use', '/blog/best-rowing-machines', 9500, 8.2],
    ['standing desk converter', '/blog/standing-desk-guide', 14000, 12.5],
    ['best yoga mat for hot yoga', '/blog/yoga-mat-buying-guide', 6200, 6.4],
    ['kettlebell workout for women', '/blog/kettlebell-weights-explained', 11000, 15.8],
    ['foam roller for back pain', '/blog/foam-roller-benefits', 4800, 7.7],
    ['resistance band leg workout', '/blog/resistance-bands-workouts', 8800, 10.4],
    ['best protein powder without sucralose', '/blog/protein-powder-guide', 3200, 17.5],
    ['under desk treadmill', '/blog/treadmill-vs-walking-pad', 16000, 13.2],
    ['how much water should i drink', '/blog/water-bottle-sizes', 22000, 18.9],
    ['sleep tracker accuracy', '/blog/sleep-tracker-review', 2100, 5.6],
    ['jump rope size chart', '/blog/jump-rope-guide', 900, 9.1],
    ['gym bag essentials', '/blog/gym-bag-checklist', 260, 11],
    // smaller prizes: a medium opportunity and two that are already close to what their position should earn
    ['plank challenge for beginners', '/blog/workout-playlist-tips', 280, 3.9],
    ['stretching routine after a run', '/blog/summer-running-tips', 220, 4.5],
    ['yoga block height', '/blog/yoga-mat-buying-guide', 200, 4.0, 1.35],
    ['wall pilates basics', '/blog/pilates-ring-guide', 210, 4.1, 1.4],
  ];
  for (const [q, path, impr, pos, ctr] of striking) add(path, q, { impr, pos, ctr });

  // --- Growth and loss (recent 3 months = k -2..0, earlier 3 = k -5..-3) -------------------------
  const recent = (k) => k >= -2;
  const growth = [
    ['rowing machine for small spaces', '/blog/best-rowing-machines', { impr: (k) => (recent(k) ? 3600 : k === -3 ? 120 : 0), pos: 6.5 }], // new
    ['best rowing machine under 500', '/blog/best-rowing-machines', { impr: (k) => (k >= -3 ? 4200 : 2600), pos: (k) => lerp(k, -5, -1, 11.5, 5.5) }], // ranking
    ['standing desk height calculator', '/blog/standing-desk-guide', { impr: (k) => (recent(k) ? 7200 : 3600), pos: 4.6 }], // demand
    ['yoga mat cleaning', '/blog/yoga-mat-buying-guide', { impr: 4500, pos: 5.2, ctr: (k) => (recent(k) ? 1.9 : 1) }], // ctr
    ['kettlebell swing form', '/blog/kettlebell-weights-explained', { impr: (k) => (recent(k) ? 5200 : 4000), pos: (k) => (recent(k) ? 7.5 : 5.4), ctr: (k) => (recent(k) ? 1.6 : 1) }], // mixed
  ];
  const losses = [
    ['home gym equipment list', '/blog/home-gym-ideas-2024', { impr: (k) => (recent(k) ? 60 : k <= -3 ? 5200 : 0), pos: 6.2 }], // lost
    ['best dumbbells for home', '/blog/best-dumbbells-2023', { impr: (k) => (recent(k) ? 3000 : 4600), pos: (k) => lerp(k, -5, -1, 4.6, 10.5) }], // ranking drop
    ['pull up bar installation', '/blog/pull-up-bar-roundup', { impr: (k) => (recent(k) ? 2400 : 5600), pos: 5.0 }], // demand drop
    ['jump rope workout', '/blog/jump-rope-guide', { impr: 5200, pos: 5.5, ctr: (k) => (recent(k) ? 0.55 : 1) }], // ctr drop
    ['exercise bike resistance levels', '/blog/exercise-bike-faq', { impr: (k) => (recent(k) ? 5300 : 4400), pos: (k) => (recent(k) ? 8 : 5.6), ctr: (k) => (recent(k) ? 0.6 : 1) }], // mixed
  ];
  for (const [q, path, o] of [...growth, ...losses]) add(path, q, o);
  // Internal shift: one query, traffic simply moves from one page to another.
  add('/blog/yoga-mat-buying-guide', 'yoga mat for pilates', { impr: (k) => (recent(k) ? 5800 : 2200), pos: 5 });
  add('/products/yoga-mats', 'yoga mat for pilates', { impr: (k) => (recent(k) ? 2000 : 5400), pos: 5.4 });

  // --- Brand ----------------------------------------------------------------------------------
  add('/', 'acmefit', { impr: 30000, pos: 1.1, ctr: 2.3 });
  add('/', 'acmefit login', { impr: 12000, pos: 1.0, ctr: 2.8 });
  add('/products/rowing-machines', 'acmefit rowing machine', { impr: 6000, pos: 1.4, ctr: 2 });

  // --- Rows -----------------------------------------------------------------------------------
  const rows = [];
  entries.forEach((e) => {
    months.forEach((month, i) => {
      const k = i - 17;
      const impr = val(e.impr, k);
      if (!(impr >= 1)) return;
      const pos = val(e.pos, k);
      const ctrMult = e.ctr ? val(e.ctr, k) : 1;
      for (const s of SLICES) {
        const imprRow = Math.round(impr * s.share * (0.93 + rand() * 0.14));
        if (imprRow < 1) continue;
        const posRow = Math.max(1, pos + (rand() - 0.5) * 0.5);
        const clicks = Math.round(imprRow * benchmarkCtr(posRow) * ctrMult * (0.92 + rand() * 0.16));
        rows.push({ month, query: e.query, page: e.page, country: s.country, device: s.device, clicks, impressions: imprRow, position: Math.round(posRow * 100) / 100 });
      }
    });
  });
  return rows;
}
