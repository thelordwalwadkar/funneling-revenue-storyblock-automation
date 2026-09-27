const SITE_URL = 'https://funnellingrevenue.com';

export function absoluteUrl(path: string) {
	return new URL(path, SITE_URL).toString();
}

export function organizationSchema() {
	return {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		'@id': `${SITE_URL}/#organization`,
		name: 'Funnelling Revenue',
		url: SITE_URL,
		logo: absoluteUrl('/favicon.svg'),
		description:
			'Revenue-first marketing agency for manufacturers and industrial brands. SEO, Generative Engine Optimization (GEO), Answer Engine Optimization (AEO), and revenue-driven content.',
		founder: {
			'@type': 'Person',
			name: 'Shubham Walwadkar',
			sameAs: ['https://www.linkedin.com/in/seo-shubham/'],
		},
		sameAs: ['https://www.linkedin.com/in/seo-shubham/'],
		areaServed: 'Worldwide',
		knowsAbout: [
			'Industrial SEO',
			'Generative Engine Optimization',
			'Answer Engine Optimization',
			'B2B manufacturing marketing',
		],
	};
}

export function websiteSchema() {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		'@id': `${SITE_URL}/#website`,
		url: SITE_URL,
		name: 'Funnelling Revenue',
		description: 'The funnel is eternal. The medium isn’t.',
		publisher: { '@id': `${SITE_URL}/#organization` },
	};
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: item.name,
			item: absoluteUrl(item.path),
		})),
	};
}

export function faqPageSchema(faq: { q: string; a: string }[]) {
	return {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: faq.map((item) => ({
			'@type': 'Question',
			name: item.q,
			acceptedAnswer: { '@type': 'Answer', text: item.a },
		})),
	};
}

export function serviceSchema(opts: {
	name: string;
	description: string;
	path: string;
}) {
	return {
		'@context': 'https://schema.org',
		'@type': 'Service',
		serviceType: opts.name,
		name: opts.name,
		description: opts.description,
		url: absoluteUrl(opts.path),
		provider: { '@id': `${SITE_URL}/#organization` },
		areaServed: 'Worldwide',
		audience: {
			'@type': 'Audience',
			audienceType: 'Manufacturers and industrial brands',
		},
	};
}

export function collectionPageSchema(opts: {
	name: string;
	description: string;
	path: string;
}) {
	return {
		'@context': 'https://schema.org',
		'@type': 'CollectionPage',
		name: opts.name,
		description: opts.description,
		url: absoluteUrl(opts.path),
		isPartOf: { '@id': `${SITE_URL}/#website` },
	};
}

export function articleSchema(opts: {
	headline: string;
	description: string;
	path: string;
}) {
	return {
		'@context': 'https://schema.org',
		'@type': 'Article',
		headline: opts.headline,
		description: opts.description,
		url: absoluteUrl(opts.path),
		author: {
			'@type': 'Person',
			name: 'Shubham Walwadkar',
			sameAs: ['https://www.linkedin.com/in/seo-shubham/'],
		},
		publisher: { '@id': `${SITE_URL}/#organization` },
	};
}
