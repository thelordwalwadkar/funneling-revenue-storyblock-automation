import { randomUUID } from 'node:crypto';
import { getConfig, ensureFolder, upsertStory } from './lib.mjs';
import { readServices, readIndustries, readCaseStudies, readPillars } from './content-reader.mjs';

const uid = () => randomUUID();
const lines = (arr = []) => arr.join('\n');
const paragraphs = (arr = []) => arr.join('\n\n');
// Storyblok number fields only accept numeric strings.
const numStr = (n) => (n == null ? '' : String(n));

function faqBloks(faq = []) {
	return faq.map((f) => ({ component: 'faq_item', _uid: uid(), q: f.q, a: f.a }));
}

function methodologyBloks(methodology = []) {
	return methodology.map((m) => ({ component: 'methodology_step', _uid: uid(), title: m.title, body: m.body }));
}

function statBloks(metrics = []) {
	return metrics.map((m) => ({ component: 'stat_item', _uid: uid(), value: m.value, label: m.label }));
}

function mapService(data) {
	return {
		title: data.title,
		h1: data.h1,
		metaTitle: data.metaTitle,
		metaDescription: data.metaDescription,
		order: numStr(data.order),
		priority: data.priority,
		funnelStages: data.funnelStages,
		funnelCaption: data.funnelCaption,
		oneLiner: data.oneLiner,
		problemHeading: data.problemHeading,
		problemBody: data.problemBody,
		methodology: methodologyBloks(data.methodology),
		whatYouGet: lines(data.whatYouGet),
		revenueMetric: data.revenueMetric,
		miniCaseStudyRef: data.miniCaseStudy?.caseStudy ?? '',
		miniCaseStudyQuote: data.miniCaseStudy?.quote ?? '',
		faq: faqBloks(data.faq),
	};
}

function mapIndustry(data) {
	return {
		title: data.title,
		h1: data.h1,
		metaTitle: data.metaTitle,
		metaDescription: data.metaDescription,
		order: numStr(data.order),
		oneLiner: data.oneLiner,
		credentials: data.credentials,
		buyer: data.buyer,
		keywordUniverse: lines(data.keywordUniverse),
		differentiator: data.differentiator,
		channelsWork: lines(data.channelsWork),
		channelsAvoid: lines(data.channelsAvoid),
		anchorCaseStudy: data.anchorCaseStudy,
		anchorSnippet: data.anchorSnippet,
		faq: faqBloks(data.faq),
	};
}

function mapCaseStudy(data) {
	return {
		client: data.client,
		h1: data.h1,
		metaTitle: data.metaTitle,
		metaDescription: data.metaDescription,
		order: numStr(data.order),
		industry: data.industry,
		servicesUsed: lines(data.servicesUsed),
		engagementDuration: data.engagementDuration,
		headlineMetric: data.headlineMetric,
		metrics: statBloks(data.metrics),
		funnelStage: data.funnelStage,
		funnelBeforeTofu: data.funnelBefore?.tofu,
		funnelBeforeMofu: data.funnelBefore?.mofu,
		funnelBeforeBofu: data.funnelBefore?.bofu,
		actionsTofu: lines(data.actionsByStage?.tofu),
		actionsMofu: lines(data.actionsByStage?.mofu),
		actionsBofu: lines(data.actionsByStage?.bofu),
		funnelAfterTofu: data.funnelAfter?.tofu,
		funnelAfterMofu: data.funnelAfter?.mofu,
		funnelAfterBofu: data.funnelAfter?.bofu,
		revenueImpact: data.revenueImpact,
		quote: data.quote ?? '',
		aiToday: data.aiToday,
		nextCaseStudy: data.nextCaseStudy,
		anonymized: !!data.anonymized,
		anonymizedNote: data.anonymizedNote ?? '',
	};
}

function mapPillar(data) {
	return {
		title: data.title,
		h1: data.h1,
		metaTitle: data.metaTitle,
		metaDescription: data.metaDescription,
		order: numStr(data.order),
		priority: data.priority,
		primaryKeyword: data.primaryKeyword,
		description: data.description,
		manifesto: paragraphs(data.manifesto),
		plannedPosts: lines(data.plannedPosts),
		ctaLabel: data.ctaLabel,
		ctaHref: data.ctaHref,
	};
}

async function main() {
	const config = getConfig();

	console.log('Ensuring folders...');
	const servicesFolder = await ensureFolder(config, { slug: 'services', fullSlug: 'services', name: 'Services' });
	const industriesFolder = await ensureFolder(config, { slug: 'industries', fullSlug: 'industries', name: 'Industries' });
	const caseStudiesFolder = await ensureFolder(config, { slug: 'case-studies', fullSlug: 'case-studies', name: 'Case Studies' });
	const insightsFolder = await ensureFolder(config, { slug: 'insights', fullSlug: 'insights', name: 'Insights' });
	const pillarFolder = await ensureFolder(config, {
		slug: 'pillar',
		fullSlug: 'insights/pillar',
		name: 'Insights Pillars',
		parentId: insightsFolder.id,
	});

	console.log('Pushing services...');
	for (const { slug, data } of readServices()) {
		await upsertStory(config, {
			slug,
			fullSlug: `services/${slug}`,
			name: data.title,
			component: 'service',
			content: mapService(data),
			parentId: servicesFolder.id,
		});
	}

	console.log('Pushing industries...');
	for (const { slug, data } of readIndustries()) {
		await upsertStory(config, {
			slug,
			fullSlug: `industries/${slug}`,
			name: data.title,
			component: 'industry',
			content: mapIndustry(data),
			parentId: industriesFolder.id,
		});
	}

	console.log('Pushing case studies...');
	for (const { slug, data } of readCaseStudies()) {
		await upsertStory(config, {
			slug,
			fullSlug: `case-studies/${slug}`,
			name: data.client,
			component: 'case_study',
			content: mapCaseStudy(data),
			parentId: caseStudiesFolder.id,
		});
	}

	console.log('Pushing pillars...');
	for (const { slug, data } of readPillars()) {
		await upsertStory(config, {
			slug,
			fullSlug: `insights/pillar/${slug}`,
			name: data.title,
			component: 'pillar',
			content: mapPillar(data),
			parentId: pillarFolder.id,
		});
	}

	console.log('Done. Check your Storyblok space — every entry should now exist as a Story.');
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
