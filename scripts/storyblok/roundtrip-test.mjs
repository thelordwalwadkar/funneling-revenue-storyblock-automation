// Offline check, no Storyblok access needed: every Markdown entry must survive
// frontmatter -> Storyblok content -> frontmatter unchanged.
//   npm run storyblok:test
import assert from 'node:assert/strict';
import { readCollection } from './content-reader.mjs';
import { SPECS, toStory, fromStory } from './mappers.mjs';

// Optional empties and `anonymized: false` are intentionally omitted on the way back.
const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === false || v === '' || (Array.isArray(v) && !v.length) ? undefined : v)));

let n = 0;
for (const [component, spec] of Object.entries(SPECS)) {
	for (const { slug, data } of readCollection(spec.dir)) {
		const back = fromStory(component, toStory(component, data));
		// Only compare the keys the spec manages.
		const keys = new Set(spec.fields.map(([p]) => p.split('.')[0]));
		const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.has(k)));
		try {
			assert.deepEqual(norm(back), norm(pick(data)));
		} catch (e) {
			console.error(`FAIL ${spec.dir}/${slug}`);
			throw e;
		}
		const unmanaged = Object.keys(data).filter((k) => !keys.has(k));
		assert.equal(unmanaged.length, 0, `${spec.dir}/${slug} has fields the spec does not manage: ${unmanaged}`);
		n++;
	}
}
console.log(`OK: ${n} entries round-trip losslessly.`);
