// One declarative spec per content type drives BOTH directions:
//   toStory(type, frontmatter)  -> Storyblok story content  (used by push-stories)
//   fromStory(type, content)    -> frontmatter object        (used by pull-stories)
// Keeping a single spec means the two directions cannot drift apart;
// roundtrip-test.mjs proves toStory -> fromStory is lossless for every file in src/content.
import { randomUUID } from 'node:crypto';

// [frontmatter path, Storyblok field, kind, optional]
const COMMON = [
	['metaTitle', 'metaTitle', 'str'],
	['metaDescription', 'metaDescription', 'str'],
	['order', 'order', 'num'],
];

export const SPECS = {
	service: {
		folder: 'services',
		dir: 'services',
		nameField: 'title',
		fields: [
			['title', 'title', 'str'],
			['h1', 'h1', 'str'],
			...COMMON,
			['priority', 'priority', 'str'],
			['funnelStages', 'funnelStages', 'arr'],
			['funnelCaption', 'funnelCaption', 'str'],
			['oneLiner', 'oneLiner', 'str'],
			['problemHeading', 'problemHeading', 'str'],
			['problemBody', 'problemBody', 'str'],
			['methodology', 'methodology', 'steps'],
			['whatYouGet', 'whatYouGet', 'lines'],
			['revenueMetric', 'revenueMetric', 'str'],
			['miniCaseStudy.caseStudy', 'miniCaseStudyRef', 'str', true],
			['miniCaseStudy.quote', 'miniCaseStudyQuote', 'str', true],
			['faq', 'faq', 'faq'],
		],
	},
	industry: {
		folder: 'industries',
		dir: 'industries',
		nameField: 'title',
		fields: [
			['title', 'title', 'str'],
			['h1', 'h1', 'str'],
			...COMMON,
			['oneLiner', 'oneLiner', 'str'],
			['credentials', 'credentials', 'str'],
			['buyer', 'buyer', 'str'],
			['keywordUniverse', 'keywordUniverse', 'lines'],
			['differentiator', 'differentiator', 'str'],
			['channelsWork', 'channelsWork', 'lines'],
			['channelsAvoid', 'channelsAvoid', 'lines', true],
			['anchorCaseStudy', 'anchorCaseStudy', 'str'],
			['anchorSnippet', 'anchorSnippet', 'str'],
			['faq', 'faq', 'faq'],
		],
	},
	case_study: {
		folder: 'case-studies',
		dir: 'case-studies',
		nameField: 'client',
		fields: [
			['client', 'client', 'str'],
			['h1', 'h1', 'str'],
			...COMMON,
			['industry', 'industry', 'str'],
			['servicesUsed', 'servicesUsed', 'lines'],
			['engagementDuration', 'engagementDuration', 'str'],
			['headlineMetric', 'headlineMetric', 'str'],
			['metrics', 'metrics', 'stats'],
			['funnelStage', 'funnelStage', 'str'],
			['funnelBefore.tofu', 'funnelBeforeTofu', 'str'],
			['funnelBefore.mofu', 'funnelBeforeMofu', 'str'],
			['funnelBefore.bofu', 'funnelBeforeBofu', 'str'],
			['actionsByStage.tofu', 'actionsTofu', 'lines'],
			['actionsByStage.mofu', 'actionsMofu', 'lines'],
			['actionsByStage.bofu', 'actionsBofu', 'lines'],
			['funnelAfter.tofu', 'funnelAfterTofu', 'str'],
			['funnelAfter.mofu', 'funnelAfterMofu', 'str'],
			['funnelAfter.bofu', 'funnelAfterBofu', 'str'],
			['revenueImpact', 'revenueImpact', 'str'],
			['quote', 'quote', 'str', true],
			['aiToday', 'aiToday', 'str'],
			['nextCaseStudy', 'nextCaseStudy', 'str'],
			['anonymized', 'anonymized', 'bool', true],
			['anonymizedNote', 'anonymizedNote', 'str', true],
		],
	},
	pillar: {
		folder: 'insights/pillar',
		dir: 'pillars',
		nameField: 'title',
		fields: [
			['title', 'title', 'str'],
			['h1', 'h1', 'str'],
			...COMMON,
			['priority', 'priority', 'str'],
			['primaryKeyword', 'primaryKeyword', 'str'],
			['description', 'description', 'str'],
			['manifesto', 'manifesto', 'paras'],
			['plannedPosts', 'plannedPosts', 'lines'],
			['ctaLabel', 'ctaLabel', 'str'],
			['ctaHref', 'ctaHref', 'str'],
		],
	},
	author: {
		folder: 'authors',
		dir: 'authors',
		nameField: 'name',
		fields: [
			['name', 'name', 'str'],
			['role', 'role', 'str'],
			['h1', 'h1', 'str'],
			...COMMON,
			['headline', 'headline', 'str'],
			['bio', 'bio', 'paras'],
			['credentials', 'credentials', 'stats'],
			['clients', 'clients', 'lines'],
			['principles', 'principles', 'steps'],
			['sameAs', 'sameAs', 'lines'],
			['email', 'email', 'str'],
			['knowsAbout', 'knowsAbout', 'lines'],
			['quote', 'quote', 'str', true],
		],
	},
	tool: {
		folder: 'tools',
		dir: 'tools',
		nameField: 'title',
		fields: [
			['title', 'title', 'str'],
			['h1', 'h1', 'str'],
			...COMMON,
			['kind', 'kind', 'str'],
			['toolId', 'toolId', 'str'],
			['icon', 'icon', 'str'],
			['oneLiner', 'oneLiner', 'str'],
			['inputLabel', 'inputLabel', 'str', true],
			['inputPlaceholder', 'inputPlaceholder', 'str', true],
			['buttonLabel', 'buttonLabel', 'str', true],
			['whatYouGet', 'whatYouGet', 'lines'],
			['howItWorks', 'howItWorks', 'steps'],
			['faq', 'faq', 'faq'],
		],
	},
};

const uid = () => randomUUID();
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
	const ks = p.split('.');
	let cur = o;
	for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
	cur[ks.at(-1)] = v;
};

const encode = {
	str: (v) => (v == null ? '' : String(v)),
	// Storyblok number fields only accept numeric strings.
	num: (v) => (v == null ? '' : String(v)),
	bool: (v) => !!v,
	arr: (v) => v ?? [],
	lines: (v) => (v ?? []).join('\n'),
	paras: (v) => (v ?? []).join('\n\n'),
	faq: (v) => (v ?? []).map((f) => ({ component: 'faq_item', _uid: uid(), q: f.q, a: f.a })),
	steps: (v) => (v ?? []).map((m) => ({ component: 'methodology_step', _uid: uid(), title: m.title, body: m.body })),
	stats: (v) => (v ?? []).map((m) => ({ component: 'stat_item', _uid: uid(), value: m.value, label: m.label })),
};

const decode = {
	str: (v) => (v == null ? '' : String(v)),
	num: (v) => Number(v),
	bool: (v) => !!v,
	arr: (v) => (Array.isArray(v) ? v : []),
	lines: (v) => String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
	paras: (v) => String(v ?? '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean),
	faq: (v) => (v ?? []).map((b) => ({ q: b.q, a: b.a })),
	steps: (v) => (v ?? []).map((b) => ({ title: b.title, body: b.body })),
	stats: (v) => (v ?? []).map((b) => ({ value: b.value, label: b.label })),
};

export function toStory(type, data) {
	const out = {};
	for (const [path, key, kind] of SPECS[type].fields) out[key] = encode[kind](getPath(data, path));
	return out;
}

export function fromStory(type, content) {
	const out = {};
	for (const [path, key, kind, optional] of SPECS[type].fields) {
		const value = decode[kind](content?.[key]);
		const empty = value === '' || value === false || (Array.isArray(value) && value.length === 0);
		if (optional && empty) continue;
		setPath(out, path, value);
	}
	return out;
}
