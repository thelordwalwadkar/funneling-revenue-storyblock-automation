// The optional server features (GEO URL mode, live page-status check) live behind a configurable address.
// config.api is a template such as '/api/{name}' (Node server) or '../api/{name}.php' (PHP hosting).
// An empty value means "no server": the tools then hide those two features and everything else still works.
export const hasApi = (config) => !!config.api;

export function apiUrl(config, name, target) {
  if (!config.api) return null;
  return `${config.api.replace('{name}', name)}?url=${encodeURIComponent(target)}`;
}
