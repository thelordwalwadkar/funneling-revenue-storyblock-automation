const API_BASE = 'https://mapi.storyblok.com/v1/spaces';

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required env var: ${name}`);
	}
	return value;
}

export function getConfig() {
	return {
		token: requireEnv('STORYBLOK_MANAGEMENT_TOKEN'),
		spaceId: requireEnv('STORYBLOK_SPACE_ID'),
	};
}

async function request(path, { method = 'GET', body, token } = {}) {
	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers: {
			Authorization: token,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Storyblok API ${method} ${path} -> ${res.status}: ${text}`);
	}
	if (res.status === 204) return null;
	return res.json();
}

/** Components (content type schemas) **/

export async function listComponents({ token, spaceId }) {
	const data = await request(`/${spaceId}/components`, { token });
	return data.components ?? [];
}

export async function upsertComponent({ token, spaceId }, componentDef) {
	const existing = await listComponents({ token, spaceId });
	const match = existing.find((c) => c.name === componentDef.name);

	if (match) {
		await request(`/${spaceId}/components/${match.id}`, {
			method: 'PUT',
			token,
			body: { component: { ...componentDef, id: match.id } },
		});
		console.log(`  ~ updated component "${componentDef.name}"`);
	} else {
		await request(`/${spaceId}/components`, {
			method: 'POST',
			token,
			body: { component: componentDef },
		});
		console.log(`  + created component "${componentDef.name}"`);
	}
}

/** Folders (used to group stories under /services/, /industries/, etc.) **/

export async function ensureFolder({ token, spaceId }, { slug, fullSlug, name, parentId }) {
	const data = await request(`/${spaceId}/stories?with_slug=${fullSlug}&is_folder=1`, { token });
	const existing = data.stories?.find((s) => s.full_slug === fullSlug && s.is_folder);
	if (existing) return existing;

	const created = await request(`/${spaceId}/stories`, {
		method: 'POST',
		token,
		body: { story: { name, slug, parent_id: parentId, is_folder: true } },
	});
	console.log(`  + created folder "${fullSlug}"`);
	return created.story;
}

/** Stories (content entries) **/

export async function findStoryByFullSlug({ token, spaceId }, fullSlug) {
	const data = await request(`/${spaceId}/stories?with_slug=${fullSlug}`, { token });
	return data.stories?.find((s) => s.full_slug === fullSlug) ?? null;
}

export async function upsertStory({ token, spaceId }, { slug, fullSlug, name, component, content, parentId, publish = true }) {
	const existing = await findStoryByFullSlug({ token, spaceId }, fullSlug);

	const storyPayload = {
		name,
		slug,
		parent_id: parentId,
		content: { component, ...content },
	};

	const query = publish ? '?publish=1' : '';

	if (existing) {
		await request(`/${spaceId}/stories/${existing.id}${query}`, {
			method: 'PUT',
			token,
			body: { story: storyPayload },
		});
		console.log(`  ~ updated story "${fullSlug}"`);
		return existing;
	}

	const created = await request(`/${spaceId}/stories${query}`, {
		method: 'POST',
		token,
		body: { story: storyPayload },
	});
	console.log(`  + created story "${fullSlug}"`);
	return created.story;
}
