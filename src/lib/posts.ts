/**
 * Long-form posts that are live. A pillar's `plannedPosts` entry with the same
 * title is shown as a link instead of "Coming soon", and a post with a
 * `service` gets a "go deeper" link on that service page.
 *
 * Anchor texts are deliberately different in each direction so the guide and
 * the service page support each other without competing for the same phrase:
 * the guide owns "industrial seo", the service page owns "manufacturing seo".
 */
export interface PublishedPost {
	title: string; // must match the pillar's plannedPosts entry
	path: string;
	description: string;
	pillar: string;
	service?: string; // slug in src/content/services
	serviceBlurb?: string;
	serviceAnchor?: string; // anchor text on the service page
}

export const publishedPosts: PublishedPost[] = [
	{
		title: 'SEO for industrial companies: the complete guide',
		path: '/insights/industrial-seo-guide/',
		description:
			'How search really works for manufacturers: the buyer journey, a B2B SEO strategy in six steps, technical SEO explained in plant terms, and the mistakes that waste budgets.',
		pillar: 'manufacturing-marketing',
		service: 'seo',
		serviceBlurb:
			'Want the full picture before you talk to anyone? Our guide covers the buyer journey, the strategy, the technical basics and the common mistakes, in plain language.',
		serviceAnchor: 'Read the guide: SEO for industrial companies',
	},
];

export const postByTitle = (title: string) => publishedPosts.find((p) => p.title === title);
export const postForService = (serviceId: string) => publishedPosts.find((p) => p.service === serviceId);
