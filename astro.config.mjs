// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';

// Pages are prerendered (static) by default; only src/pages/api/* opts out with
// `export const prerender = false`, so the site is fast and the backend is a
// small Node server (see Dockerfile) that serves both.
// https://astro.build/config
export default defineConfig({
	site: 'https://funnellingrevenue.com',
	trailingSlash: 'always',
	adapter: node({ mode: 'standalone' }),
	integrations: [sitemap({ filter: (page) => !page.includes('/admin/') })],
	vite: {
		plugins: [tailwindcss()],
	},
});
