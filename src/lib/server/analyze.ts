/**
 * Analysis engine behind the URL tools. Pure functions over fetched HTML plus
 * a small orchestrator. No dependencies: the HTML is scanned with targeted
 * regexes, which is enough for head metadata, headings, links and JSON-LD.
 */
import { safeFetch, normalizeUrl, FetchError, type FetchResult } from './safe-fetch';

export type Status = 'pass' | 'warn' | 'fail';
export type ToolId = 'audit' | 'ai-visibility' | 'serp-preview';

export interface Check {
	id: string;
	group: string;
	label: string;
	status: Status;
	detail: string;
	fix?: string;
	weight: number;
}

export interface Analysis {
	tool: ToolId;
	url: string;
	finalUrl: string;
	host: string;
	score: number;
	grade: 'A' | 'B' | 'C' | 'D' | 'F';
	headline: string;
	checks: Check[];
	facts: Record<string, unknown>;
	funnel?: { tofu: number; mofu: number; bofu: number };
	topFixes: string[];
	fetchedMs: number;
}

/* ------------------------------ HTML helpers ------------------------------ */

const decode = (s: string) =>
	s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
		.replace(/\s+/g, ' ')
		.trim();

const stripTags = (s: string) => decode(s.replace(/<[^>]*>/g, ' '));

function attr(tag: string, name: string): string | undefined {
	const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
	return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : undefined;
}

function metaContent(html: string, key: 'name' | 'property', value: string): string | undefined {
	const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
	for (const tag of tags) {
		if (attr(tag, key)?.toLowerCase() === value.toLowerCase()) return attr(tag, 'content');
	}
	return undefined;
}

function linkHref(html: string, rel: string): string | undefined {
	const tags = html.match(/<link\b[^>]*>/gi) ?? [];
	for (const tag of tags) {
		const r = attr(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
		if (r.includes(rel)) return attr(tag, 'href');
	}
	return undefined;
}

function jsonLdTypes(html: string): { types: string[]; nodes: any[] } {
	const types = new Set<string>();
	const nodes: any[] = [];
	const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let m: RegExpExecArray | null;
	const visit = (n: any) => {
		if (!n || typeof n !== 'object') return;
		if (Array.isArray(n)) return n.forEach(visit);
		nodes.push(n);
		const t = n['@type'];
		(Array.isArray(t) ? t : t ? [t] : []).forEach((x: unknown) => types.add(String(x)));
		if (n['@graph']) visit(n['@graph']);
	};
	while ((m = re.exec(html))) {
		try {
			visit(JSON.parse(m[1].trim()));
		} catch {
			/* malformed JSON-LD is reported as absence */
		}
	}
	return { types: [...types], nodes };
}

export interface PageFacts {
	title: string;
	description: string;
	canonical?: string;
	robotsMeta?: string;
	viewport?: string;
	lang?: string;
	h1: string[];
	h2: string[];
	h3Count: number;
	og: { title?: string; description?: string; image?: string; type?: string };
	twitterCard?: string;
	schemaTypes: string[];
	schemaNodes: any[];
	imgCount: number;
	imgNoAlt: number;
	wordCount: number;
	internalLinks: number;
	externalLinks: number;
	hreflangCount: number;
	hasForm: boolean;
	ctaCount: number;
	hasPhoneOrMail: boolean;
	listCount: number;
	tableCount: number;
	questionHeadings: number;
	authorSignal: boolean;
	modified?: string;
	linkTexts: string[];
	hrefs: string[];
	text: string;
}

export function extractFacts(html: string, pageUrl: URL): PageFacts {
	const head = html.slice(0, 400_000);
	const titleM = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
	const body = html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ');
	const headings = (n: number) =>
		[...body.matchAll(new RegExp(`<h${n}\\b[^>]*>([\\s\\S]*?)</h${n}>`, 'gi'))].map((m) => stripTags(m[1])).filter(Boolean);
	const h1 = headings(1);
	const h2 = headings(2);
	const h3 = headings(3);

	const imgs = body.match(/<img\b[^>]*>/gi) ?? [];
	const imgNoAlt = imgs.filter((t) => {
		const a = attr(t, 'alt');
		return a === undefined || a === '';
	}).length;

	const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
	let internal = 0;
	let external = 0;
	const linkTexts: string[] = [];
	const hrefs: string[] = [];
	for (const a of anchors) {
		const href = attr(a[1], 'href');
		if (!href || href.startsWith('#') || /^(javascript:)/i.test(href)) continue;
		hrefs.push(href);
		linkTexts.push(stripTags(a[2]).toLowerCase().slice(0, 80));
		try {
			const u = new URL(href, pageUrl);
			if (u.protocol === 'http:' || u.protocol === 'https:') {
				u.hostname.replace(/^www\./, '') === pageUrl.hostname.replace(/^www\./, '') ? internal++ : external++;
			}
		} catch {
			/* ignore */
		}
	}

	const text = stripTags(body);
	const ld = jsonLdTypes(html);
	const buttons = [...body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => stripTags(m[1]).toLowerCase());
	const ctaRe = /(contact|quote|enquir|inquir|demo|get started|book|request|talk to|call us|buy now|schedule|consult|free audit|download|pricing)/i;
	const ctaCount = [...linkTexts, ...buttons].filter((t) => ctaRe.test(t)).length;

	const modified =
		metaContent(html, 'property', 'article:modified_time') ??
		metaContent(html, 'property', 'og:updated_time') ??
		ld.nodes.map((n) => n.dateModified).find(Boolean);

	const authorSignal =
		!!metaContent(html, 'name', 'author') ||
		ld.types.includes('Person') ||
		ld.nodes.some((n) => n.author) ||
		/rel\s*=\s*["']author["']/i.test(html);

	return {
		title: titleM ? stripTags(titleM[1]) : '',
		description: metaContent(head, 'name', 'description') ?? '',
		canonical: linkHref(head, 'canonical'),
		robotsMeta: metaContent(head, 'name', 'robots'),
		viewport: metaContent(head, 'name', 'viewport'),
		lang: attr(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang'),
		h1,
		h2,
		h3Count: h3.length,
		og: {
			title: metaContent(head, 'property', 'og:title'),
			description: metaContent(head, 'property', 'og:description'),
			image: metaContent(head, 'property', 'og:image'),
			type: metaContent(head, 'property', 'og:type'),
		},
		twitterCard: metaContent(head, 'name', 'twitter:card'),
		schemaTypes: ld.types,
		schemaNodes: ld.nodes,
		imgCount: imgs.length,
		imgNoAlt,
		wordCount: text ? text.split(/\s+/).length : 0,
		internalLinks: internal,
		externalLinks: external,
		hreflangCount: (head.match(/<link\b[^>]*hreflang/gi) ?? []).length,
		hasForm: /<form\b/i.test(body),
		ctaCount,
		hasPhoneOrMail: /href\s*=\s*["'](tel|mailto):/i.test(body),
		listCount: (body.match(/<(ul|ol)\b/gi) ?? []).length,
		tableCount: (body.match(/<table\b/gi) ?? []).length,
		questionHeadings: [...h2, ...h3].filter((h) => /\?$/.test(h) || /^(what|how|why|when|which|can|does|is|are)\b/i.test(h)).length,
		authorSignal,
		modified,
		linkTexts,
		hrefs,
		text,
	};
}

/* ------------------------------ robots / llms ------------------------------ */

export const AI_BOTS = [
	{ name: 'GPTBot', owner: 'OpenAI (training)' },
	{ name: 'OAI-SearchBot', owner: 'ChatGPT search' },
	{ name: 'ChatGPT-User', owner: 'ChatGPT browsing' },
	{ name: 'ClaudeBot', owner: 'Anthropic' },
	{ name: 'Claude-SearchBot', owner: 'Claude search' },
	{ name: 'PerplexityBot', owner: 'Perplexity' },
	{ name: 'Google-Extended', owner: 'Gemini / Google AI' },
	{ name: 'Applebot-Extended', owner: 'Apple Intelligence' },
	{ name: 'CCBot', owner: 'Common Crawl' },
	{ name: 'Bytespider', owner: 'ByteDance' },
] as const;

interface RobotsGroup {
	agents: string[];
	disallow: string[];
	allow: string[];
}

export function parseRobots(txt: string): { groups: RobotsGroup[]; sitemaps: string[] } {
	const groups: RobotsGroup[] = [];
	const sitemaps: string[] = [];
	let cur: RobotsGroup | null = null;
	let lastWasAgent = false;
	for (const raw of txt.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, '').trim();
		const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
		if (!m) continue;
		const k = m[1].toLowerCase();
		const v = m[2].trim();
		if (k === 'user-agent') {
			if (!cur || !lastWasAgent) {
				cur = { agents: [], disallow: [], allow: [] };
				groups.push(cur);
			}
			cur.agents.push(v.toLowerCase());
			lastWasAgent = true;
			continue;
		}
		lastWasAgent = false;
		if (k === 'sitemap') sitemaps.push(v);
		else if (cur && k === 'disallow') cur.disallow.push(v);
		else if (cur && k === 'allow') cur.allow.push(v);
	}
	return { groups, sitemaps };
}

export function botAccess(robots: ReturnType<typeof parseRobots> | null, bot: string): 'allowed' | 'blocked' | 'unspecified' {
	if (!robots) return 'unspecified';
	const specific = robots.groups.find((g) => g.agents.includes(bot.toLowerCase()));
	const group = specific ?? robots.groups.find((g) => g.agents.includes('*'));
	if (!group) return 'unspecified';
	const blockedAll = group.disallow.includes('/') && !group.allow.includes('/');
	return blockedAll ? 'blocked' : specific ? 'allowed' : 'unspecified';
}

/* --------------------------------- scoring --------------------------------- */

const pts: Record<Status, number> = { pass: 1, warn: 0.5, fail: 0 };

function score(checks: Check[]) {
	const total = checks.reduce((s, c) => s + c.weight, 0) || 1;
	const got = checks.reduce((s, c) => s + c.weight * pts[c.status], 0);
	const n = Math.round((got / total) * 100);
	const grade = n >= 90 ? 'A' : n >= 75 ? 'B' : n >= 60 ? 'C' : n >= 40 ? 'D' : 'F';
	return { n, grade: grade as Analysis['grade'] };
}

function topFixes(checks: Check[]) {
	return checks
		.filter((c) => c.status !== 'pass' && c.fix)
		.sort((a, b) => b.weight * (b.status === 'fail' ? 1 : 0.5) - a.weight * (a.status === 'fail' ? 1 : 0.5))
		.slice(0, 5)
		.map((c) => c.fix as string);
}

const mk = (group: string, id: string, label: string, status: Status, detail: string, weight: number, fix?: string): Check => ({
	id,
	group,
	label,
	status,
	detail,
	weight,
	fix,
});

/* --------------------------------- tool: audit ------------------------------ */

function funnelCoverage(f: PageFacts) {
	const corpus = [...f.hrefs, ...f.linkTexts, ...f.h2].join(' ').toLowerCase();
	const count = (re: RegExp) => (corpus.match(re) ?? []).length;
	const tofu = count(/\b(blog|insights?|guides?|learn|resources?|what-is|what is|how to|articles?|news|glossary)\b/g);
	const mofu = count(/\b(case[- ]stud|compare|vs|versus|datasheet|spec|whitepaper|white paper|webinar|catalog|brochure|applications?|solutions?|industries|download)\b/g);
	const bofu = count(/\b(contact|quote|demo|pricing|request|enquir|inquir|book|consult|talk to|get started|buy|distributors?|dealers?)\b/g) + f.ctaCount + (f.hasForm ? 3 : 0);
	const norm = (n: number, goal: number) => Math.min(100, Math.round((n / goal) * 100));
	return { tofu: norm(tofu, 6), mofu: norm(mofu, 6), bofu: norm(bofu, 6) };
}

function auditChecks(f: PageFacts, res: FetchResult): Check[] {
	const c: Check[] = [];
	const G1 = 'Technical foundation';
	const G2 = 'On-page signals';
	const G3 = 'Funnel & conversion';
	const isHttps = res.finalUrl.startsWith('https:');

	c.push(mk(G1, 'https', 'Served over HTTPS', isHttps ? 'pass' : 'fail', isHttps ? 'Secure connection.' : 'The page loads over plain HTTP.', 10, 'Install an SSL certificate and 301-redirect all HTTP URLs to HTTPS.'));
	c.push(mk(G1, 'status', 'Page returns 200 OK', res.status === 200 ? 'pass' : 'fail', `HTTP status ${res.status}.`, 10, 'Make sure this URL returns a 200 status without errors.'));
	const noindex = /noindex/i.test(f.robotsMeta ?? '');
	c.push(mk(G1, 'indexable', 'Indexable by search engines', noindex ? 'fail' : 'pass', noindex ? 'A noindex robots tag blocks this page from search.' : 'No noindex directive found.', 12, 'Remove the noindex directive so the page can rank.'));
	c.push(mk(G1, 'canonical', 'Canonical URL set', f.canonical ? 'pass' : 'warn', f.canonical ? `Canonical: ${f.canonical}` : 'No canonical tag found.', 6, 'Add a self-referencing canonical tag to prevent duplicate-content dilution.'));
	c.push(mk(G1, 'viewport', 'Mobile viewport defined', f.viewport ? 'pass' : 'fail', f.viewport ? 'Viewport meta present.' : 'No viewport meta tag, so mobile layouts will break.', 8, 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'));
	c.push(mk(G1, 'lang', 'Language declared', f.lang ? 'pass' : 'warn', f.lang ? `lang="${f.lang}"` : 'No lang attribute on <html>.', 3, 'Set the lang attribute on the <html> element.'));
	const hops = res.redirects.length;
	c.push(mk(G1, 'redirects', 'No redirect chain', hops <= 1 ? 'pass' : hops <= 2 ? 'warn' : 'fail', hops ? `${hops} redirect(s) before the final page.` : 'No redirects.', 4, 'Collapse redirect chains into a single 301.'));

	const tl = f.title.length;
	c.push(mk(G2, 'title', 'Title tag length (30–60)', !tl ? 'fail' : tl >= 30 && tl <= 60 ? 'pass' : 'warn', tl ? `${tl} characters: "${f.title}"` : 'Missing title tag.', 12, tl ? 'Rewrite the title to 30–60 characters with the primary keyword up front.' : 'Add a unique, keyword-led title tag.'));
	const dl = f.description.length;
	c.push(mk(G2, 'description', 'Meta description length (70–160)', !dl ? 'fail' : dl >= 70 && dl <= 160 ? 'pass' : 'warn', dl ? `${dl} characters.` : 'Missing meta description.', 8, 'Write a 70–160 character description that sells the click and names the outcome.'));
	c.push(mk(G2, 'h1', 'Exactly one H1', f.h1.length === 1 ? 'pass' : f.h1.length === 0 ? 'fail' : 'warn', f.h1.length === 1 ? `"${f.h1[0].slice(0, 90)}"` : `${f.h1.length} H1 tags found.`, 8, 'Use a single H1 that states what the page is about.'));
	c.push(mk(G2, 'h2', 'Structured with subheadings', f.h2.length >= 2 ? 'pass' : f.h2.length === 1 ? 'warn' : 'fail', `${f.h2.length} H2 and ${f.h3Count} H3 headings.`, 5, 'Break the page into scannable sections with descriptive H2s.'));
	c.push(mk(G2, 'words', 'Enough substantive content', f.wordCount >= 400 ? 'pass' : f.wordCount >= 150 ? 'warn' : 'fail', `About ${f.wordCount.toLocaleString()} words of visible text.`, 7, 'Expand the page with specifications, applications and buyer-question answers.'));
	const altPct = f.imgCount ? Math.round(((f.imgCount - f.imgNoAlt) / f.imgCount) * 100) : 100;
	c.push(mk(G2, 'alt', 'Images have alt text', altPct >= 90 ? 'pass' : altPct >= 60 ? 'warn' : 'fail', f.imgCount ? `${altPct}% of ${f.imgCount} images have alt text.` : 'No images found.', 4, 'Add descriptive alt text to every meaningful image.'));
	c.push(mk(G2, 'schema', 'Structured data present', f.schemaTypes.length ? 'pass' : 'fail', f.schemaTypes.length ? `Found: ${f.schemaTypes.slice(0, 6).join(', ')}.` : 'No JSON-LD structured data.', 8, 'Add Organization, Product/Service and FAQPage JSON-LD.'));
	c.push(mk(G2, 'internal', 'Internal linking', f.internalLinks >= 10 ? 'pass' : f.internalLinks >= 3 ? 'warn' : 'fail', `${f.internalLinks} internal and ${f.externalLinks} external links.`, 4, 'Link to related service, case-study and resource pages.'));

	c.push(mk(G3, 'cta', 'Clear calls to action', f.ctaCount >= 3 ? 'pass' : f.ctaCount >= 1 ? 'warn' : 'fail', `${f.ctaCount} CTA-style links/buttons found.`, 10, 'Add a visible primary CTA above the fold and repeat it down the page.'));
	c.push(mk(G3, 'capture', 'Lead capture path', f.hasForm || f.hasPhoneOrMail ? 'pass' : 'fail', f.hasForm ? 'A form is on the page.' : f.hasPhoneOrMail ? 'Phone/email link found.' : 'No form, phone or email link found.', 10, 'Give buyers a low-friction way to enquire: short form, click-to-call or email.'));
	const cov = funnelCoverage(f);
	const weakest = (Object.entries(cov).sort((a, b) => a[1] - b[1])[0]);
	const minCov = weakest[1];
	c.push(mk(G3, 'funnel', 'Funnel stage coverage', minCov >= 50 ? 'pass' : minCov >= 20 ? 'warn' : 'fail', `ToFu ${cov.tofu} · MoFu ${cov.mofu} · BoFu ${cov.bofu} (out of 100).`, 9, `Your ${weakest[0].toUpperCase().replace('FU', 'Fu')} stage is the thinnest: add content and links that serve it.`));
	return c;
}

/* ------------------------------ tool: ai-visibility ------------------------- */

function geoChecks(f: PageFacts, res: FetchResult, ctx: { robots: ReturnType<typeof parseRobots> | null; llms: boolean; sitemap: boolean; robotsFound: boolean }): Check[] {
	const c: Check[] = [];
	const G1 = 'AI crawler access';
	const G2 = 'Machine-readable signals';
	const G3 = 'Citable content';

	const blockedBots = AI_BOTS.filter((b) => botAccess(ctx.robots, b.name) === 'blocked');
	const searchBots = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot'];
	const blockedSearch = blockedBots.filter((b) => searchBots.includes(b.name));
	c.push(mk(G1, 'ai-search-bots', 'AI answer engines can fetch your pages', blockedSearch.length ? 'fail' : 'pass', blockedSearch.length ? `Blocked: ${blockedSearch.map((b) => b.name).join(', ')}.` : 'ChatGPT, Perplexity and Claude search crawlers are not blocked.', 18, 'Remove the robots.txt rules blocking OAI-SearchBot, ChatGPT-User, PerplexityBot and Claude-SearchBot.'));
	c.push(mk(G1, 'ai-training-bots', 'Training crawlers policy is deliberate', blockedBots.length - blockedSearch.length ? 'warn' : 'pass', blockedBots.length - blockedSearch.length ? `Blocking: ${blockedBots.filter((b) => !searchBots.includes(b.name)).map((b) => b.name).join(', ')}. Fine if intentional, but it limits brand presence in model knowledge.` : 'No AI training crawlers are blocked.', 4, 'Decide deliberately whether to allow GPTBot, ClaudeBot and Google-Extended.'));
	c.push(mk(G1, 'robots', 'robots.txt present', ctx.robotsFound ? 'pass' : 'warn', ctx.robotsFound ? 'robots.txt found.' : 'No robots.txt found.', 4, 'Publish a robots.txt that declares your sitemap and crawler policy.'));
	c.push(mk(G1, 'sitemap', 'XML sitemap discoverable', ctx.sitemap ? 'pass' : 'warn', ctx.sitemap ? 'Sitemap found.' : 'No sitemap found in robots.txt or at /sitemap.xml.', 5, 'Publish an XML sitemap and reference it in robots.txt.'));
	c.push(mk(G1, 'llms', 'llms.txt published', ctx.llms ? 'pass' : 'warn', ctx.llms ? '/llms.txt found.' : 'No /llms.txt file.', 8, 'Publish /llms.txt: a short, linked summary of what you do and your key pages for LLMs.'));

	const has = (t: string) => f.schemaTypes.some((x) => x.toLowerCase() === t.toLowerCase());
	const org = f.schemaNodes.find((n) => [].concat(n['@type']).some((t: string) => /^(Organization|LocalBusiness|Corporation|ProfessionalService)$/i.test(t)));
	c.push(mk(G2, 'org-schema', 'Organization entity defined', org ? 'pass' : 'fail', org ? `Organization: ${org.name ?? 'unnamed'}.` : 'No Organization schema found.', 10, 'Add Organization JSON-LD with name, logo, url and sameAs profile links so engines can resolve your brand entity.'));
	c.push(mk(G2, 'sameas', 'Entity linked to external profiles (sameAs)', org?.sameAs ? 'pass' : 'warn', org?.sameAs ? 'sameAs links present.' : 'No sameAs links.', 5, 'List LinkedIn, Wikipedia/Wikidata and other authoritative profiles in sameAs.'));
	c.push(mk(G2, 'faq-schema', 'FAQ / Q&A structured data', has('FAQPage') || has('QAPage') ? 'pass' : 'warn', has('FAQPage') || has('QAPage') ? 'FAQ schema found.' : 'No FAQPage schema.', 8, 'Mark up real buyer questions and answers with FAQPage JSON-LD.'));
	c.push(mk(G2, 'content-schema', 'Page-type schema (Article / Product / Service)', ['Article', 'BlogPosting', 'Product', 'Service', 'WebPage', 'CollectionPage', 'ProfilePage'].some(has) ? 'pass' : 'warn', f.schemaTypes.length ? `Types: ${f.schemaTypes.slice(0, 6).join(', ')}.` : 'No page-level schema.', 6, 'Add schema matching the page type (Product, Service or Article).'));
	c.push(mk(G2, 'breadcrumb', 'Breadcrumb markup', has('BreadcrumbList') ? 'pass' : 'warn', has('BreadcrumbList') ? 'BreadcrumbList found.' : 'No BreadcrumbList.', 2, 'Add BreadcrumbList schema to show site hierarchy.'));

	c.push(mk(G3, 'question-headings', 'Headings that mirror buyer questions', f.questionHeadings >= 3 ? 'pass' : f.questionHeadings >= 1 ? 'warn' : 'fail', `${f.questionHeadings} question-style headings.`, 8, 'Turn key H2/H3s into the questions buyers actually ask, then answer in the first sentence.'));
	c.push(mk(G3, 'structure', 'Lists and tables LLMs can quote', f.listCount + f.tableCount >= 3 ? 'pass' : f.listCount + f.tableCount >= 1 ? 'warn' : 'fail', `${f.listCount} lists, ${f.tableCount} tables.`, 5, 'Add comparison tables, spec tables and bulleted takeaways: formats AI answers lift directly.'));
	c.push(mk(G3, 'author', 'Authorship / E-E-A-T signal', f.authorSignal ? 'pass' : 'warn', f.authorSignal ? 'An author or Person entity is declared.' : 'No author information detected.', 6, 'Show a named expert author with credentials and Person schema.'));
	const fresh = f.modified ?? (res.headers['last-modified'] as string | undefined);
	let age: number | null = null;
	if (fresh && !isNaN(Date.parse(fresh))) age = Math.round((Date.now() - Date.parse(fresh)) / 86400000);
	c.push(mk(G3, 'freshness', 'Freshness signal', age === null ? 'warn' : age <= 365 ? 'pass' : 'warn', age === null ? 'No modified date exposed.' : `Last modified about ${age} days ago.`, 4, 'Expose dateModified in schema and refresh key pages at least yearly.'));
	c.push(mk(G3, 'depth', 'Depth to be a source', f.wordCount >= 600 ? 'pass' : f.wordCount >= 250 ? 'warn' : 'fail', `About ${f.wordCount.toLocaleString()} words.`, 5, 'Add original data, specifications and application detail worth citing.'));
	return c;
}

/* ------------------------------ tool: serp-preview -------------------------- */

function metaChecks(f: PageFacts): Check[] {
	const c: Check[] = [];
	const G1 = 'Search result snippet';
	const G2 = 'Social sharing';
	const tl = f.title.length;
	c.push(mk(G1, 'title-len', 'Title fits the SERP (30–60 chars)', !tl ? 'fail' : tl >= 30 && tl <= 60 ? 'pass' : 'warn', tl ? `${tl} characters${tl > 60 ? ': will be truncated' : tl < 30 ? ': leaves space unused' : ''}.` : 'No title tag.', 20, 'Keep the title to 30–60 characters, primary keyword first, brand last.'));
	const dl = f.description.length;
	c.push(mk(G1, 'desc-len', 'Description fits the SERP (70–160 chars)', !dl ? 'fail' : dl >= 70 && dl <= 160 ? 'pass' : 'warn', dl ? `${dl} characters${dl > 160 ? ': will be truncated' : dl < 70 ? ': too thin to sell the click' : ''}.` : 'No meta description.', 20, 'Write a 70–160 character description with a benefit and a reason to click.'));
	const t = f.title.toLowerCase();
	const h = (f.h1[0] ?? '').toLowerCase();
	c.push(mk(G1, 'title-h1', 'Title and H1 are aligned but not identical', !h ? 'warn' : t === h ? 'warn' : 'pass', !h ? 'No H1 to compare.' : t === h ? 'Title and H1 are identical: use the title for the SERP and the H1 for the page.' : 'Title and H1 differ.', 6, 'Differentiate the title (for the SERP) from the H1 (for the reader).'));
	c.push(mk(G1, 'canonical', 'Canonical set', f.canonical ? 'pass' : 'warn', f.canonical ?? 'No canonical tag.', 8, 'Add a canonical tag so the right URL is shown.'));
	c.push(mk(G2, 'og', 'Open Graph tags (title, description, image)', f.og.title && f.og.description && f.og.image ? 'pass' : f.og.title || f.og.description ? 'warn' : 'fail', `title ${f.og.title ? '✓' : '✗'} · description ${f.og.description ? '✓' : '✗'} · image ${f.og.image ? '✓' : '✗'}`, 22, 'Add og:title, og:description and a 1200×630 og:image.'));
	c.push(mk(G2, 'twitter', 'Twitter / X card', f.twitterCard ? 'pass' : 'warn', f.twitterCard ?? 'No twitter:card.', 12, 'Add <meta name="twitter:card" content="summary_large_image">.'));
	return c;
}

/** Deterministic rewrite hints; no model call needed. */
function metaSuggestions(f: PageFacts, host: string) {
	const brand = host.replace(/^www\./, '').split('.')[0];
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	let title = f.title || f.h1[0] || '';
	if (title.length > 60) {
		const parts = title.split(/\s[|\-–—:]\s/);
		title = parts[0].length >= 25 ? parts[0] : title.slice(0, 57).replace(/\s+\S*$/, '') + '…';
	}
	if (title && title.length <= 50 && !new RegExp(brand, 'i').test(title)) title = `${title} | ${cap(brand)}`;
	let desc = f.description || f.text.slice(0, 200);
	if (desc.length > 160) desc = desc.slice(0, 157).replace(/\s+\S*$/, '') + '…';
	return { title, description: desc };
}

/* -------------------------------- orchestrator ------------------------------ */

async function textFile(base: URL, path: string): Promise<string | null> {
	try {
		const r = await safeFetch(new URL(path, base), { maxBytes: 300_000, timeoutMs: 5000, maxRedirects: 2, accept: 'text/plain,*/*;q=0.5' });
		if (r.status !== 200) return null;
		const ct = String(r.headers['content-type'] ?? '');
		if (/html/i.test(ct) && /<html|<!doctype/i.test(r.body.slice(0, 400))) return null;
		return r.body;
	} catch {
		return null;
	}
}

export async function analyze(tool: ToolId, input: string): Promise<Analysis> {
	const start = normalizeUrl(input);
	const res = await safeFetch(start, { maxBytes: 1_500_000, timeoutMs: 9000 });
	const ct = String(res.headers['content-type'] ?? '');
	if (res.status >= 400 && res.status !== 403 && res.status !== 404 && res.body.length < 50) {
		throw new FetchError('http', `The site responded with HTTP ${res.status}.`);
	}
	if (ct && !/html|xml/i.test(ct)) {
		throw new FetchError('not_html', 'That address does not return a web page (HTML).');
	}
	const finalUrl = new URL(res.finalUrl);
	const facts = extractFacts(res.body, finalUrl);
	const host = finalUrl.hostname;

	let checks: Check[];
	let extra: Record<string, unknown> = {};
	let funnel: Analysis['funnel'];

	if (tool === 'audit') {
		checks = auditChecks(facts, res);
		funnel = funnelCoverage(facts);
		extra = { words: facts.wordCount, title: facts.title, h1: facts.h1[0] ?? '', schemaTypes: facts.schemaTypes };
	} else if (tool === 'ai-visibility') {
		const [robotsTxt, llmsTxt, sitemapTxt] = await Promise.all([textFile(finalUrl, '/robots.txt'), textFile(finalUrl, '/llms.txt'), textFile(finalUrl, '/sitemap.xml')]);
		const robots = robotsTxt ? parseRobots(robotsTxt) : null;
		const sitemap = !!robots?.sitemaps.length || !!(sitemapTxt && /<(urlset|sitemapindex)/i.test(sitemapTxt));
		checks = geoChecks(facts, res, { robots, llms: !!llmsTxt && llmsTxt.trim().length > 20, sitemap, robotsFound: !!robotsTxt });
		extra = {
			bots: AI_BOTS.map((b) => ({ ...b, access: botAccess(robots, b.name) })),
			llmsTxt: !!llmsTxt,
			schemaTypes: facts.schemaTypes,
		};
	} else {
		checks = metaChecks(facts);
		extra = {
			title: facts.title,
			description: facts.description,
			canonical: facts.canonical ?? null,
			og: facts.og,
			twitterCard: facts.twitterCard ?? null,
			suggestion: metaSuggestions(facts, host),
		};
	}

	const { n, grade } = score(checks);
	const failed = checks.filter((c) => c.status === 'fail').length;
	const headline =
		n >= 85
			? 'Strong foundation. The gains now come from content and conversion depth.'
			: n >= 60
				? `Solid base with ${failed || 'a few'} gap${failed === 1 ? '' : 's'} that are likely costing you qualified demand.`
				: `Significant leaks: ${failed} critical issue${failed === 1 ? '' : 's'} are holding back qualified pipeline.`;

	return {
		tool,
		url: start.toString(),
		finalUrl: res.finalUrl,
		host,
		score: n,
		grade,
		headline,
		checks,
		facts: { ...extra, status: res.status, redirects: res.redirects.length, truncated: res.truncated },
		funnel,
		topFixes: topFixes(checks),
		fetchedMs: res.ms,
	};
}
