/**
 * Fetches a user-supplied URL without letting it reach our own network.
 *
 * The tools let anyone type a URL and have the server request it, which is a
 * textbook SSRF vector. Defences, in order:
 *   1. Only http(s) on the default ports, no embedded credentials.
 *   2. Literal-IP hosts are checked before connecting.
 *   3. Hostnames are resolved by a custom `lookup` that rejects private,
 *      loopback, link-local and metadata addresses *at connect time*, so DNS
 *      rebinding cannot swap in an internal address after validation.
 *   4. Redirects are followed manually and every hop is re-validated.
 *   5. Hard timeout and a byte cap on the (decompressed) body.
 */
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

export class FetchError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
] as const) {
	blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
	['::', 128],
	['::1', 128],
	['64:ff9b::', 96], // NAT64
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
] as const) {
	blocked.addSubnet(addr, prefix, 'ipv6');
}

export function isBlockedIp(ip: string): boolean {
	const family = net.isIP(ip);
	if (!family) return true;
	// IPv4-mapped IPv6 is never legitimate for a public host. (It cannot be a BlockList
	// rule: Node compares IPv4 addresses as mapped IPv6, so the rule would match every IPv4.)
	if (family === 6 && /^(0{0,4}:){0,5}ffff:/i.test(ip) || /^::ffff:/i.test(ip)) return true;
	return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** Turns whatever a visitor typed into a validated URL, or throws FetchError. */
export function normalizeUrl(input: string): URL {
	let raw = String(input ?? '').trim();
	if (!raw || raw.length > 2048 || /\s/.test(raw)) {
		throw new FetchError('bad_url', 'Enter a valid website address, like example.com.');
	}
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new FetchError('bad_url', 'That does not look like a valid website address.');
	}
	assertAllowed(url);
	return url;
}

function assertAllowed(url: URL) {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new FetchError('bad_url', 'Only http and https addresses can be analysed.');
	}
	if (url.username || url.password) {
		throw new FetchError('bad_url', 'Addresses with embedded credentials are not allowed.');
	}
	if (url.port && url.port !== '80' && url.port !== '443') {
		throw new FetchError('bad_url', 'Only standard web ports (80/443) can be analysed.');
	}
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (net.isIP(host)) {
		if (isBlockedIp(host)) throw new FetchError('blocked', 'That address is not publicly reachable.');
		return;
	}
	if (
		!host.includes('.') ||
		host === 'localhost' ||
		/\.(local|localhost|internal|lan|home|corp|intranet)$/.test(host)
	) {
		throw new FetchError('blocked', 'That address is not publicly reachable.');
	}
}

function guardedLookup(hostname: string, options: any, cb: any) {
	dns.lookup(hostname, { all: true, family: options?.family ?? 0 }, (err, addrs) => {
		if (err) return cb(err);
		if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
			return cb(new FetchError('blocked', 'That address is not publicly reachable.'));
		}
		if (options?.all) return cb(null, addrs);
		cb(null, addrs[0].address, addrs[0].family);
	});
}

export interface FetchResult {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
	truncated: boolean;
	finalUrl: string;
	redirects: string[];
	ms: number;
}

interface Options {
	maxBytes?: number;
	timeoutMs?: number;
	maxRedirects?: number;
	accept?: string;
}

function once(url: URL, { maxBytes = 1_500_000, timeoutMs = 9000, accept = 'text/html,*/*;q=0.5' }: Options) {
	return new Promise<Omit<FetchResult, 'finalUrl' | 'redirects' | 'ms'>>((resolve, reject) => {
		const lib = url.protocol === 'https:' ? https : http;
		const req = lib.request(
			url,
			{
				method: 'GET',
				agent: false,
				timeout: timeoutMs,
				lookup: guardedLookup as any,
				headers: {
					'user-agent': 'FunnelingRevenueBot/1.0 (+https://funnelingrevenue.com/tools/)',
					accept,
					'accept-encoding': 'gzip, deflate, br',
					'accept-language': 'en',
				},
			},
			(res) => {
				const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
				let stream: NodeJS.ReadableStream = res;
				if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
				else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
				else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

				const chunks: Buffer[] = [];
				let size = 0;
				let truncated = false;
				let done = false;
				const finish = () => {
					if (done) return;
					done = true;
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString('utf8'),
						truncated,
					});
				};
				stream.on('data', (chunk: Buffer) => {
					if (done) return;
					size += chunk.length;
					if (size > maxBytes) {
						truncated = true;
						chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
						finish();
						res.destroy();
						return;
					}
					chunks.push(chunk);
				});
				stream.on('end', finish);
				stream.on('error', (e) => {
					if (!done) {
						done = true;
						reject(e);
					}
				});
				res.on('error', () => finish());
			},
		);
		req.on('timeout', () => req.destroy(new FetchError('timeout', 'The site took too long to respond.')));
		req.on('error', (e) => {
			if (e instanceof FetchError) return reject(e);
			const code = (e as any).code ?? 'network';
			const msg =
				code === 'ENOTFOUND'
					? 'We could not find that domain.'
					: /certificate|SSL|TLS|self.signed/i.test(e.message)
						? 'The site has an invalid or expired SSL certificate.'
						: 'We could not connect to that site.';
			reject(new FetchError(code, msg));
		});
		req.end();
	});
}

export async function safeFetch(start: URL | string, options: Options = {}): Promise<FetchResult> {
	const t0 = Date.now();
	let url = typeof start === 'string' ? normalizeUrl(start) : start;
	const redirects: string[] = [];
	const max = options.maxRedirects ?? 4;
	for (let hop = 0; hop <= max; hop++) {
		assertAllowed(url);
		const res = await once(url, options);
		const loc = res.headers.location;
		if (res.status >= 300 && res.status < 400 && loc) {
			if (hop === max) throw new FetchError('redirects', 'The site redirects too many times.');
			redirects.push(url.toString());
			try {
				url = new URL(loc, url);
			} catch {
				throw new FetchError('bad_redirect', 'The site redirects to an invalid address.');
			}
			continue;
		}
		return { ...res, finalUrl: url.toString(), redirects, ms: Date.now() - t0 };
	}
	throw new FetchError('redirects', 'The site redirects too many times.');
}
