/**
 * The Cloudflare Worker that puts Kaabil on HTTPS.
 *
 * It does two things:
 *  - serves the built screens (the app at "/" and the test page at "/test/") as static assets;
 *  - forwards "/api/*" (and the developer console at "/dev") to the backend, which runs elsewhere
 *    (for the Round 2 demo: on a laptop, reached through a Cloudflare quick tunnel).
 *
 * Where the backend is lives in the account's KV store under the key "origin", so it can change
 * without deploying again. The Worker will only forward to an https address on an allowed host
 * suffix, so a wrong value can never turn it into an open proxy.
 *
 * To the browser everything is one HTTPS origin: no CORS, and the sign-in cookie belongs to this host.
 */

/** The little of Cloudflare's types this file needs, so it builds and tests without them. */
export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
export interface KV {
  get(key: string): Promise<string | null>;
}
export interface Env {
  ASSETS: Fetcher;
  CONFIG: KV;
  /** Comma-separated host suffixes the backend may be on. Default: Cloudflare quick tunnels. */
  ALLOWED_ORIGIN_SUFFIXES?: string;
}

const DEFAULT_SUFFIXES = ['.trycloudflare.com'];

export const isProxied = (path: string) => path === '/dev' || path.startsWith('/api/');

/** Is this a backend address we are willing to forward to? https only, no credentials, no path, on an allowed host. */
export function allowedOrigin(value: string | null, suffixes: string[] = DEFAULT_SUFFIXES): URL | null {
  if (!value) return null;
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  const hostOk = suffixes.some((s) => u.hostname.endsWith(s) && u.hostname.length > s.length);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hostOk) return null;
  return u;
}

const problem = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!isProxied(url.pathname)) return env.ASSETS.fetch(request);

  const suffixes = env.ALLOWED_ORIGIN_SUFFIXES?.split(',').map((s) => s.trim()).filter(Boolean);
  const raw = await env.CONFIG.get('origin');
  if (!raw) return problem(503, 'backend_not_configured', 'The backend address is not set. Whoever runs the demo must start the tunnel and set it.');
  const origin = allowedOrigin(raw, suffixes?.length ? suffixes : undefined);
  if (!origin) return problem(503, 'backend_not_allowed', 'The backend address is not an allowed https address.');

  const headers = new Headers(request.headers);
  headers.delete('host');
  for (const name of [...headers.keys()]) if (name.startsWith('cf-') || name === 'x-real-ip') headers.delete(name);
  // The backend limits guessing by client address, so it must see the visitor's address, never one the visitor claims.
  headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? 'unknown');
  headers.set('x-forwarded-proto', 'https');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    const upstream = await fetch(new Request(`${origin.origin}${url.pathname}${url.search}`, { method: request.method, headers, body: hasBody ? request.body : null, redirect: 'manual', duplex: 'half' } as RequestInit));
    const out = new Response(upstream.body, upstream);
    out.headers.set('x-kaabil-edge', '1');
    return out;
  } catch {
    return problem(502, 'backend_unreachable', 'The backend is not reachable. Whoever runs the demo must start it.');
  }
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
