// Storyblok -> repo. Reads every story the editors changed in Storyblok and
// rewrites the matching src/content/*.md, so title / meta / copy edits made in
// the Storyblok UI land in git and redeploy the site. Run by
// .github/workflows/storyblok-pull.yml when Storyblok publishes (see
// src/pages/api/storyblok-webhook.ts), or manually: npm run storyblok:pull
import { getConfig, listStories, getStory } from './lib.mjs';
import { writeEntry } from './content-reader.mjs';
import { SPECS, fromStory } from './mappers.mjs';

async function main() {
	const config = getConfig();
	let changed = 0;
	for (const [component, spec] of Object.entries(SPECS)) {
		const stories = (await listStories(config, `${spec.folder}/`)).filter((s) => !s.is_folder && s.parent_id && s.full_slug.split('/').length === spec.folder.split('/').length + 1);
		console.log(`${spec.folder}: ${stories.length} stories`);
		for (const summary of stories) {
			const story = await getStory(config, summary.id);
			if (story.content?.component !== component) continue;
			const data = fromStory(component, story.content);
			if (writeEntry(spec.dir, story.slug, data)) {
				console.log(`  ~ ${spec.dir}/${story.slug}.md updated`);
				changed++;
			}
		}
	}
	console.log(changed ? `Done: ${changed} file(s) changed.` : 'Done: repo already matches Storyblok.');
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
