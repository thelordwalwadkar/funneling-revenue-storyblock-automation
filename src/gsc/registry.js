// Which module drives which tool page. Loaded on demand so a visitor only downloads the tool they opened.
export const LOADERS = {
	'content-decay': async () => (await import('./tools/decay.js')).tool,
	'keyword-cannibalization': async () => (await import('./tools/cannibalization.js')).tool,
	'striking-distance': async () => (await import('./tools/striking.js')).tool,
	'keyword-growth': async () => (await import('./tools/movement.js')).growthTool,
	'loss-detector': async () => (await import('./tools/movement.js')).lossTool,
	'internal-link-gap': async () => (await import('./tools/linkgap.js')).tool,
	'index-bloat': async () => (await import('./tools/indexbloat.js')).tool,
	'query-clustering': async () => (await import('./tools/clustering.js')).tool,
};

/** Run-button wording for the five Search Console tools (the three reports set their own `runLabel`). */
export const RUN_LABEL = {
	'content-decay': 'Run Content Decay',
	'keyword-cannibalization': 'Run Keyword Cannibalization',
	'striking-distance': 'Run Striking Distance',
	'keyword-growth': 'Run Keyword Growth',
	'loss-detector': 'Run Loss Detector',
};
