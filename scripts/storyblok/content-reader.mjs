import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const CONTENT_ROOT = path.join(process.cwd(), 'src', 'content');

function readCollection(dir) {
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

export function readServices() {
	return readCollection('services');
}

export function readIndustries() {
	return readCollection('industries');
}

export function readCaseStudies() {
	return readCollection('case-studies');
}

export function readPillars() {
	return readCollection('pillars');
}
