// Component (content type) schemas for Storyblok's Management API.
// Field types reference: https://www.storyblok.com/docs/api/management/content-delivery-api/components
//
// Nested repeatable structures (FAQ, methodology steps, stats) are modelled as
// small shared "bloks" components. Simple string lists (whatYouGet,
// keywordUniverse, etc.) are modelled as one textarea, one item per line —
// this keeps the schema small; scripts/storyblok/push-stories.mjs does the
// split/join so the Astro side still sees a real array.

const textField = (display_name, extra = {}) => ({ type: 'text', display_name, ...extra });
const textareaField = (display_name, extra = {}) => ({ type: 'textarea', display_name, ...extra });
const numberField = (display_name, extra = {}) => ({ type: 'number', display_name, ...extra });
const booleanField = (display_name, extra = {}) => ({ type: 'boolean', display_name, ...extra });
const optionField = (display_name, options, extra = {}) => ({
	type: 'option',
	display_name,
	options: options.map((o) => ({ name: o, value: o })),
	...extra,
});
const optionsField = (display_name, options, extra = {}) => ({
	type: 'options',
	display_name,
	options: options.map((o) => ({ name: o, value: o })),
	...extra,
});
const listField = (display_name, extra = {}) =>
	textareaField(display_name, { description: 'One item per line.', ...extra });
const bloksField = (display_name, whitelist, extra = {}) => ({
	type: 'bloks',
	display_name,
	restrict_components: true,
	component_whitelist: whitelist,
	...extra,
});

export const nestableComponents = [
	{
		name: 'faq_item',
		display_name: 'FAQ item',
		is_root: false,
		is_nestable: true,
		schema: {
			q: textField('Question'),
			a: textareaField('Answer'),
		},
	},
	{
		name: 'methodology_step',
		display_name: 'Methodology step',
		is_root: false,
		is_nestable: true,
		schema: {
			title: textField('Step title'),
			body: textareaField('Step body'),
		},
	},
	{
		name: 'stat_item',
		display_name: 'Stat item',
		is_root: false,
		is_nestable: true,
		schema: {
			value: textField('Value (e.g. 178%)'),
			label: textField('Label'),
		},
	},
];

export const contentComponents = [
	{
		name: 'service',
		display_name: 'Service',
		is_root: true,
		is_nestable: false,
		schema: {
			title: textField('Nav / card title'),
			h1: textField('H1'),
			metaTitle: textField('Meta title'),
			metaDescription: textareaField('Meta description'),
			order: numberField('Sort order'),
			priority: optionField('Priority', ['P1', 'P2']),
			funnelStages: optionsField('Funnel stages', ['ToFu', 'MoFu', 'BoFu', 'Strategic']),
			funnelCaption: textareaField('Funnel banner caption'),
			oneLiner: textareaField('One-liner'),
			problemHeading: textField('Problem heading'),
			problemBody: textareaField('Problem body'),
			methodology: bloksField('Methodology steps', ['methodology_step']),
			whatYouGet: listField('What you get'),
			revenueMetric: textareaField('Revenue metric'),
			miniCaseStudyRef: textField('Mini case study slug (references a case_study story)'),
			miniCaseStudyQuote: textareaField('Mini case study quote'),
			faq: bloksField('FAQ', ['faq_item']),
		},
	},
	{
		name: 'industry',
		display_name: 'Industry',
		is_root: true,
		is_nestable: false,
		schema: {
			title: textField('Nav / card title'),
			h1: textField('H1'),
			metaTitle: textField('Meta title'),
			metaDescription: textareaField('Meta description'),
			order: numberField('Sort order'),
			oneLiner: textareaField('One-liner'),
			credentials: textareaField('Vertical credentials'),
			buyer: textareaField('The buyer'),
			keywordUniverse: listField('Keyword universe'),
			differentiator: textareaField('Differentiator'),
			channelsWork: listField('Channels that work'),
			channelsAvoid: listField('Channels to avoid'),
			anchorCaseStudy: textField('Anchor case study slug (references a case_study story)'),
			anchorSnippet: textareaField('Anchor snippet'),
			faq: bloksField('FAQ', ['faq_item']),
		},
	},
	{
		name: 'case_study',
		display_name: 'Case Study',
		is_root: true,
		is_nestable: false,
		schema: {
			client: textField('Client name'),
			h1: textField('H1'),
			metaTitle: textField('Meta title'),
			metaDescription: textareaField('Meta description'),
			order: numberField('Sort order'),
			industry: textField('Industry slug (references an industry story)'),
			servicesUsed: listField('Service slugs used (references service stories)'),
			engagementDuration: textField('Engagement duration'),
			headlineMetric: textField('Headline metric'),
			metrics: bloksField('Metrics', ['stat_item']),
			funnelStage: optionField('Primary funnel stage', ['ToFu', 'MoFu', 'BoFu', 'Full funnel']),
			funnelBeforeTofu: textareaField('Funnel before — ToFu'),
			funnelBeforeMofu: textareaField('Funnel before — MoFu'),
			funnelBeforeBofu: textareaField('Funnel before — BoFu'),
			actionsTofu: listField('Actions — ToFu'),
			actionsMofu: listField('Actions — MoFu'),
			actionsBofu: listField('Actions — BoFu'),
			funnelAfterTofu: textareaField('Funnel after — ToFu'),
			funnelAfterMofu: textareaField('Funnel after — MoFu'),
			funnelAfterBofu: textareaField('Funnel after — BoFu'),
			revenueImpact: textareaField('Revenue impact'),
			quote: textareaField('Client quote'),
			aiToday: textareaField('What we’d do with AI today'),
			nextCaseStudy: textField('Next case study slug'),
			anonymized: booleanField('Anonymised'),
			anonymizedNote: textareaField('Anonymisation note'),
		},
	},
	{
		name: 'pillar',
		display_name: 'Insights Pillar',
		is_root: true,
		is_nestable: false,
		schema: {
			title: textField('Pillar title'),
			h1: textField('H1'),
			metaTitle: textField('Meta title'),
			metaDescription: textareaField('Meta description'),
			order: numberField('Sort order'),
			priority: optionField('Priority', ['P1', 'P2']),
			primaryKeyword: textField('Primary keyword'),
			description: textareaField('Short description'),
			manifesto: textareaField('Manifesto', { description: 'Separate paragraphs with a blank line.' }),
			plannedPosts: listField('Planned posts'),
			ctaLabel: textField('CTA label'),
			ctaHref: textField('CTA href'),
		},
	},
	{
		name: 'author',
		display_name: 'Author',
		is_root: true,
		is_nestable: false,
		schema: {
			name: textField('Full name'),
			role: textField('Role / job title'),
			h1: textField('H1'),
			metaTitle: textField('Meta title'),
			metaDescription: textareaField('Meta description'),
			order: numberField('Sort order'),
			headline: textField('One-line headline'),
			bio: textareaField('Bio', { description: 'Separate paragraphs with a blank line.' }),
			credentials: bloksField('Credential stats', ['stat_item']),
			clients: listField('Clients worked with'),
			principles: bloksField('Principles', ['methodology_step']),
			sameAs: listField('Profile URLs (LinkedIn etc.)'),
			email: textField('Contact email'),
			knowsAbout: listField('Expertise topics'),
			quote: textareaField('Pull quote'),
		},
	},
	{
		name: 'tool',
		display_name: 'Tool',
		is_root: true,
		is_nestable: false,
		schema: {
			title: textField('Tool name'),
			h1: textField('H1'),
			metaTitle: textField('Meta title'),
			metaDescription: textareaField('Meta description'),
			order: numberField('Sort order'),
			kind: optionField('Kind', ['url', 'calculator']),
			toolId: textField('Tool ID (audit | ai-visibility | serp-preview | calculator). Changing this changes behaviour.'),
			icon: textField('Icon (gauge | sparkles | search | calculator)'),
			oneLiner: textareaField('One-liner'),
			inputLabel: textField('Input label'),
			inputPlaceholder: textField('Input placeholder'),
			buttonLabel: textField('Button label'),
			whatYouGet: listField('What you get'),
			howItWorks: bloksField('How it works', ['methodology_step']),
			faq: bloksField('FAQ', ['faq_item']),
		},
	},
];

export const allComponents = [...nestableComponents, ...contentComponents];
