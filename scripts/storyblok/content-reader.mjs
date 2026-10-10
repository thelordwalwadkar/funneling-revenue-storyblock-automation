import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export const CONTENT_ROOT = path.join(process.cwd(), 'src', 'content');

/** Reads every Markdown entry in src/content/<dir> as { slug, data }. */
export function readCollection(dir) {
	const full = path.join(CONTENT_ROOT, dir);
	if (!fs.existsSync(full)) return [];
	return fs
		.readdirSync(full)
		.filter((f) => f.endsWith('.md'))
		.map((file) => {
			const slug = file.replace(/\.md$/, '');
			const raw = fs.readFileSync(path.join(full, file), 'utf-8');
			const { data } = matter(raw);
			return { slug, data };
		});
}

/** Writes frontmatter back to src/content/<dir>/<slug>.md. Returns true if the file changed. */
export function writeEntry(dir, slug, data) {
	const full = path.join(CONTENT_ROOT, dir, `${slug}.md`);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	const next = matter.stringify('', data, { lineWidth: 100 }).replace(/\r\n/g, '\n');
	const prev = fs.existsSync(full) ? fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n') : null;
	if (prev === next) return false;
	fs.writeFileSync(full, next);
	return true;
}
