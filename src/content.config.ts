import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content schemas are deliberately component-shaped (title / body arrays /
 * structured objects rather than long-form markdown) so each entry maps
 * cleanly onto a Storyblok content type later: one field here = one Storyblok
 * field, one collection = one Storyblok component. Swapping the loader below
 * for `@storyblok/astro`'s content source is the only change migration needs.
 */

const faqSchema = z.array(z.object({ q: z.string(), a: z.string() }));

const services = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
	schema: z.object({
		title: z.string(),
		h1: z.string(),
		metaTitle: z.string(),
		metaDescription: z.string(),
		order: z.number(),
		priority: z.enum(['P1', 'P2']),
		funnelStages: z.array(z.enum(['ToFu', 'MoFu', 'BoFu', 'Strategic'])),
		funnelCaption: z.string(),
		oneLiner: z.string(),
		problemHeading: z.string(),
		problemBody: z.string(),
		methodology: z.array(z.object({ title: z.string(), body: z.string() })),
		whatYouGet: z.array(z.string()),
		revenueMetric: z.string(),
		miniCaseStudy: z
			.object({ caseStudy: z.string(), quote: z.string() })
			.optional(),
		faq: faqSchema,
	}),
});

const industries = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/industries' }),
	schema: z.object({
		title: z.string(),
		h1: z.string(),
		metaTitle: z.string(),
		metaDescription: z.string(),
		order: z.number(),
		oneLiner: z.string(),
		credentials: z.string(),
		buyer: z.string(),
		keywordUniverse: z.array(z.string()),
		differentiator: z.string(),
		channelsWork: z.array(z.string()),
		channelsAvoid: z.array(z.string()).optional(),
		anchorCaseStudy: z.string(),
		anchorSnippet: z.string(),
		faq: faqSchema,
	}),
});

const caseStudies = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/case-studies' }),
	schema: z.object({
		client: z.string(),
		h1: z.string(),
		metaTitle: z.string(),
		metaDescription: z.string(),
		order: z.number(),
		industry: z.string(),
		servicesUsed: z.array(z.string()),
		engagementDuration: z.string(),
		headlineMetric: z.string(),
		metrics: z.array(z.object({ value: z.string(), label: z.string() })),
		funnelStage: z.enum(['ToFu', 'MoFu', 'BoFu', 'Full funnel']),
		funnelBefore: z.object({ tofu: z.string(), mofu: z.string(), bofu: z.string() }),
		actionsByStage: z.object({
			tofu: z.array(z.string()),
			mofu: z.array(z.string()),
			bofu: z.array(z.string()),
		}),
		funnelAfter: z.object({ tofu: z.string(), mofu: z.string(), bofu: z.string() }),
		revenueImpact: z.string(),
		quote: z.string().optional(),
		aiToday: z.string(),
		nextCaseStudy: z.string(),
		anonymized: z.boolean().default(false),
		anonymizedNote: z.string().optional(),
	}),
});

const pillars = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/pillars' }),
	schema: z.object({
		title: z.string(),
		h1: z.string(),
		metaTitle: z.string(),
		metaDescription: z.string(),
		order: z.number(),
		priority: z.enum(['P1', 'P2']),
		primaryKeyword: z.string(),
		description: z.string(),
		manifesto: z.array(z.string()),
		plannedPosts: z.array(z.string()),
		ctaLabel: z.string(),
		ctaHref: z.string(),
	}),
});

const authors = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/authors' }),
	schema: z.object({
		name: z.string(),
		role: z.string(),
		h1: z.string(),
		metaTitle: z.string(),
		metaDescription: z.string(),
		order: z.number(),
		headline: z.string(),
		bio: z.array(z.string()),
		credentials: z.array(z.object({ value: z.string(), label: z.string() })),
		clients: z.array(z.string()),
		principles: z.array(z.object({ title: z.string(), body: z.string() })),
		sameAs: z.array(z.string()),
		email: z.string(),
		knowsAbout: z.array(z.string()),
		quote: z.string().optional(),
	}),
});

const tools = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/tools' }),
	schema: z.object({
		title: z.string(),
		h1: z.string(),
		metaTitle: z.string(),
		metaDescription: z.string(),
		order: z.number(),
		kind: z.enum(['url', 'calculator']),
		// audit | ai-visibility | serp-preview (server analysers) or calculator (client-only)
		toolId: z.string(),
		icon: z.string(),
		oneLiner: z.string(),
		inputLabel: z.string().optional().default(''),
		inputPlaceholder: z.string().optional().default(''),
		buttonLabel: z.string().optional().default(''),
		whatYouGet: z.array(z.string()),
		howItWorks: z.array(z.object({ title: z.string(), body: z.string() })),
		faq: faqSchema,
	}),
});

export const collections = { services, industries, caseStudies, pillars, authors, tools };
