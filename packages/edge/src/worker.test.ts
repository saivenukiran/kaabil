import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedOrigin, handle, isProxied, type Env } from './worker';

const ORIGIN = 'https://sample-name-here.trycloudflare.com';

function env(origin: string | null = ORIGIN, extra: Partial<Env> = {}): Env & { assetsSeen: string[] } {
  const assetsSeen: string[] = [];
  return {
    assetsSeen,
    ASSETS: { fetch: (r: Request) => (assetsSeen.push(new URL(r.url).pathname), Promise.resolve(new Response('asset'))) },
    CONFIG: { get: () => Promise.resolve(origin) },
    ...extra,
  };
}

type Call = { url: string; init: RequestInit };
function stubFetch(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: Request) => {
    const c = { url: input.url, init: { method: input.method, headers: input.headers, body: input.body } as RequestInit };
    calls.push(c);
    return respond(c);
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('which paths go to the backend', () => {
  it('forwards /api/ and /dev, and nothing else', () => {
    expect(isProxied('/api/health')).toBe(true);
    expect(isProxied('/dev')).toBe(true);
    expect(isProxied('/api')).toBe(false);
    expect(isProxied('/apixyz')).toBe(false);
    expect(isProxied('/')).toBe(false);
    expect(isProxied('/test/')).toBe(false);
    expect(isProxied('/assets/app.js')).toBe(false);
  });
  it('serves everything else as static assets', async () => {
    const e = env();
    const r = await handle(new Request('https://kaabil.example.workers.dev/test/'), e);
    expect(await r.text()).toBe('asset');
    expect(e.assetsSeen).toEqual(['/test/']);
  });
});

describe('the backend address', () => {
  it('accepts an https quick tunnel address and nothing risky', () => {
    expect(allowedOrigin(ORIGIN)?.origin).toBe(ORIGIN);
    expect(allowedOrigin(`${ORIGIN}/`)?.origin).toBe(ORIGIN);
    expect(allowedOrigin('http://a-b.trycloudflare.com')).toBeNull(); // not https
    expect(allowedOrigin('https://evil.example.com')).toBeNull(); // not an allowed host
    expect(allowedOrigin('https://trycloudflare.com')).toBeNull(); // the bare suffix is not a tunnel
    expect(allowedOrigin('https://user:pw@a-b.trycloudflare.com')).toBeNull(); // credentials in the address
    expect(allowedOrigin('https://a-b.trycloudflare.com:8443')).toBeNull(); // odd port
    expect(allowedOrigin('https://a-b.trycloudflare.com.evil.example')).toBeNull(); // suffix trick
    expect(allowedOrigin('not a url')).toBeNull();
    expect(allowedOrigin(null)).toBeNull();
  });
  it('can be told other allowed host suffixes', () => {
    expect(allowedOrigin('https://api.kaabil.example', ['.kaabil.example'])?.hostname).toBe('api.kaabil.example');
  });
});

describe('forwarding to the backend', () => {
  it('sends the path and query, keeps the cookie, and never the Cloudflare headers or a claimed address', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const req = new Request('https://kaabil.example.workers.dev/api/care/groups/g1/doses?since=5', {
      headers: { cookie: 'session=abc', origin: 'https://kaabil.example.workers.dev', 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'x', 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' },
    });
    const r = await handle(req, env());
    expect(r.status).toBe(200);
    expect(r.headers.get('x-kaabil-edge')).toBe('1');
    const c = calls[0]!;
    expect(c.url).toBe(`${ORIGIN}/api/care/groups/g1/doses?since=5`);
    const h = c.init.headers as Headers;
    expect(h.get('cookie')).toBe('session=abc');
    expect(h.get('origin')).toBe('https://kaabil.example.workers.dev');
    expect(h.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(h.get('x-forwarded-proto')).toBe('https');
    expect(h.get('cf-ray')).toBeNull();
    expect(h.get('cf-connecting-ip')).toBeNull();
    expect(h.get('x-real-ip')).toBeNull();
  });

  it('passes a request body and the method through', async () => {
    const calls = stubFetch(async (c) => new Response(await new Response(c.init.body as ReadableStream).text(), { status: 201 }));
    const r = await handle(new Request('https://kaabil.example.workers.dev/api/care/groups', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }), env());
    expect(r.status).toBe(201);
    expect(await r.text()).toBe('{"a":1}');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('streams a live event response without touching it', async () => {
    stubFetch(() => new Response('data: {"type":"ping","at":1}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const r = await handle(new Request('https://kaabil.example.workers.dev/api/device/events'), env());
    expect(r.headers.get('content-type')).toBe('text/event-stream');
    expect(await r.text()).toContain('"type":"ping"');
  });

  it('does not follow a redirect from the backend, so a visitor is never sent to another host', async () => {
    stubFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    const r = await handle(new Request('https://kaabil.example.workers.dev/api/x'), env());
    expect(r.status).toBe(302);
  });

  it('forwards the developer console too', async () => {
    const calls = stubFetch(() => new Response('<html>console</html>'));
    await handle(new Request('https://kaabil.example.workers.dev/dev'), env());
    expect(calls[0]?.url).toBe(`${ORIGIN}/dev`);
  });
});

describe('when the backend is not there', () => {
  it('says so in the API error shape when no address is set', async () => {
    const r = await handle(new Request('https://kaabil.example.workers.dev/api/health'), env(null));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: { code: 'backend_not_configured' } });
  });
  it('refuses an address that is not allowed, and does not call it', async () => {
    const calls = stubFetch(() => new Response('should not be called'));
    const r = await handle(new Request('https://kaabil.example.workers.dev/api/health'), env('https://evil.example.com'));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: { code: 'backend_not_allowed' } });
    expect(calls).toHaveLength(0);
  });
  it('says the backend is unreachable when the tunnel is down', async () => {
    stubFetch(() => {
      throw new Error('connection refused');
    });
    const r = await handle(new Request('https://kaabil.example.workers.dev/api/health'), env());
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: { code: 'backend_unreachable' } });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
