import { getConfig, upsertComponent } from './lib.mjs';
import { allComponents } from './components.mjs';

async function main() {
	const config = getConfig();
	console.log(`Pushing ${allComponents.length} component schemas to Storyblok space ${config.spaceId}...`);
	for (const component of allComponents) {
		await upsertComponent(config, component);
	}
	console.log('Done.');
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
