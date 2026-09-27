// Storyblok's Management API is region-specific: a space created with US, Canada,
// Australia, or China data residency will 404/422 against the EU (default) host.
// Set STORYBLOK_REGION to match (see Space Settings -> General -> "Region" in the
// Storyblok dashboard) if you're not on the default EU space.
const REGION_HOSTS = {
	eu: 'https://mapi.storyblok.com',
	us: 'https://api-us.storyblok.com',
	ca: 'https://api-ca.storyblok.com',
	ap: 'https://api-ap.storyblok.com',
	cn: 'https://app.storyblokchina.cn',
};

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required env var: ${name}`);
	}
	return value;
}

export function getConfig() {
	const region = (process.env.STORYBLOK_REGION?.trim().toLowerCase() || 'eu');
	const host = REGION_HOSTS[region];
	if (!host) {
		throw new Error(
			`Unknown STORYBLOK_REGION "${region}" — expected one of: ${Object.keys(REGION_HOSTS).join(', ')}`,
		);
	}
	return {
		token: requireEnv('STORYBLOK_MANAGEMENT_TOKEN'),
		spaceId: requireEnv('STORYBLOK_SPACE_ID'),
		apiBase: `${host}/v1/spaces`,
	};
}

async function request(apiBase, path, { method = 'GET', body, token } = {}) {
	const res = await fetch(`${apiBase}${path}`, {
		method,
		headers: {
			Authorization: token,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		let hint = '';
		if (res.status === 401) hint = ' (check STORYBLOK_MANAGEMENT_TOKEN is a valid, unexpired Personal Access Token)';
		if (res.status === 404 || (res.status === 422 && /space/i.test(text))) {
			hint = ' (check STORYBLOK_SPACE_ID is correct, and STORYBLOK_REGION matches your space\'s data residency — see Space Settings -> General in Storyblok)';
		}
		throw new Error(`Storyblok API ${method} ${apiBase}${path} -> ${res.status}: ${text}${hint}`);
	}
	if (res.status === 204) return null;
	return res.json();
}

/** Components (content type schemas) **/

export async function listComponents({ token, spaceId, apiBase }) {
	const data = await request(apiBase, `/${spaceId}/components`, { token });
	return data.components ?? [];
}

export async function upsertComponent(config, componentDef) {
	const { token, spaceId, apiBase } = config;
	const existing = await listComponents(config);
	const match = existing.find((c) => c.name === componentDef.name);

	if (match) {
		await request(apiBase, `/${spaceId}/components/${match.id}`, {
			method: 'PUT',
			token,
			body: { component: { ...componentDef, id: match.id } },
		});
		console.log(`  ~ updated component "${componentDef.name}"`);
	} else {
		await request(apiBase, `/${spaceId}/components`, {
			method: 'POST',
			token,
			body: { component: componentDef },
		});
		console.log(`  + created component "${componentDef.name}"`);
	}
}

/** Folders (used to group stories under /services/, /industries/, etc.) **/

export async function ensureFolder({ token, spaceId, apiBase }, { slug, fullSlug, name, parentId }) {
	const data = await request(apiBase, `/${spaceId}/stories?with_slug=${fullSlug}&is_folder=1`, { token });
	const existing = data.stories?.find((s) => s.full_slug === fullSlug && s.is_folder);
	if (existing) return existing;

	const created = await request(apiBase, `/${spaceId}/stories`, {
		method: 'POST',
		token,
		body: { story: { name, slug, parent_id: parentId, is_folder: true } },
	});
	console.log(`  + created folder "${fullSlug}"`);
	return created.story;
}

/** Stories (content entries) **/

export async function findStoryByFullSlug({ token, spaceId, apiBase }, fullSlug) {
	const data = await request(apiBase, `/${spaceId}/stories?with_slug=${fullSlug}`, { token });
	return data.stories?.find((s) => s.full_slug === fullSlug) ?? null;
}

export async function upsertStory(config, { slug, fullSlug, name, component, content, parentId, publish = true }) {
	const { token, spaceId, apiBase } = config;
	const existing = await findStoryByFullSlug(config, fullSlug);

	const storyPayload = {
		name,
		slug,
		parent_id: parentId,
		content: { component, ...content },
	};

	const query = publish ? '?publish=1' : '';

	if (existing) {
		await request(apiBase, `/${spaceId}/stories/${existing.id}${query}`, {
			method: 'PUT',
			token,
			body: { story: storyPayload },
		});
		console.log(`  ~ updated story "${fullSlug}"`);
		return existing;
	}

	const created = await request(apiBase, `/${spaceId}/stories${query}`, {
		method: 'POST',
		token,
		body: { story: storyPayload },
	});
	console.log(`  + created story "${fullSlug}"`);
	return created.story;
}
