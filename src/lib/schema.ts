const SITE_URL = 'https://funnelingrevenue.com';

export function absoluteUrl(path: string) {
	return new URL(path, SITE_URL).toString();
}

export function organizationSchema() {
	return {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		'@id': `${SITE_URL}/#organization`,
		name: 'Funneling Revenue',
		url: SITE_URL,
		logo: absoluteUrl('/brand/fr-icon-512.png'),
		description:
			'Revenue-first marketing agency for manufacturers and industrial brands. SEO, Generative Engine Optimization (GEO), Answer Engine Optimization (AEO), and revenue-driven content.',
		founder: { '@id': `${SITE_URL}/author/#person` },
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
		name: 'Funneling Revenue',
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
		author: { '@id': `${SITE_URL}/author/#person`, '@type': 'Person', name: 'Shubham Walwadkar', url: absoluteUrl('/author/') },
		publisher: { '@id': `${SITE_URL}/#organization` },
	};
}

export function personSchema(a: {
	name: string;
	role: string;
	description: string;
	sameAs: string[];
	knowsAbout: string[];
	clients: string[];
	email: string;
}) {
	return {
		'@context': 'https://schema.org',
		'@type': 'Person',
		'@id': `${SITE_URL}/author/#person`,
		name: a.name,
		jobTitle: a.role,
		description: a.description,
		url: absoluteUrl('/author/'),
		email: a.email,
		sameAs: a.sameAs,
		knowsAbout: a.knowsAbout,
		worksFor: { '@id': `${SITE_URL}/#organization` },
	};
}

export function profilePageSchema(opts: { name: string; description: string; path: string }) {
	return {
		'@context': 'https://schema.org',
		'@type': 'ProfilePage',
		name: opts.name,
		description: opts.description,
		url: absoluteUrl(opts.path),
		mainEntity: { '@id': `${SITE_URL}/author/#person` },
		isPartOf: { '@id': `${SITE_URL}/#website` },
	};
}

export function softwareToolSchema(opts: { name: string; description: string; path: string }) {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebApplication',
		name: opts.name,
		description: opts.description,
		url: absoluteUrl(opts.path),
		applicationCategory: 'BusinessApplication',
		operatingSystem: 'Any (web browser)',
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
		publisher: { '@id': `${SITE_URL}/#organization` },
		author: { '@id': `${SITE_URL}/author/#person` },
	};
}
