import { getConfig, ensureFolder, upsertStory } from './lib.mjs';
import { readCollection } from './content-reader.mjs';
import { SPECS, toStory } from './mappers.mjs';

async function ensureFolderPath(config, fullSlug, names) {
	// Creates "a" then "a/b" so nested folders (insights/pillar) get the right parent.
	let parent;
	let acc = '';
	for (const part of fullSlug.split('/')) {
		acc = acc ? `${acc}/${part}` : part;
		parent = await ensureFolder(config, { slug: part, fullSlug: acc, name: names[acc] ?? part, parentId: parent?.id });
	}
	return parent;
}

const FOLDER_NAMES = {
	services: 'Services',
	industries: 'Industries',
	'case-studies': 'Case Studies',
	insights: 'Insights',
	'insights/pillar': 'Insights Pillars',
	authors: 'Authors',
	tools: 'Tools',
};

async function main() {
	const config = getConfig();
	for (const [component, spec] of Object.entries(SPECS)) {
		console.log(`Pushing ${spec.dir}...`);
		const folder = await ensureFolderPath(config, spec.folder, FOLDER_NAMES);
		for (const { slug, data } of readCollection(spec.dir)) {
			await upsertStory(config, {
				slug,
				fullSlug: `${spec.folder}/${slug}`,
				name: data[spec.nameField],
				component,
				content: toStory(component, data),
				parentId: folder.id,
			});
		}
	}
	console.log('Done. Check your Storyblok space: every entry should now exist as a Story.');
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
