import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES } from '@kaabil/contract';
import { makeApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

/** What the server really answers to, as "METHOD /path". Middleware and Better Auth's catch-all are not endpoints of ours. */
function registered(app: TestApp['app']): string[] {
  return [...new Set(app.routes.filter((r) => r.method !== 'ALL' && !r.path.includes('*') && !r.path.startsWith('/api/auth/')).map((r) => `${r.method} ${r.path}`))].sort();
}

describe('the API documentation matches the server', () => {
  it('documents every endpoint the server has', () => {
    const documented = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    const missing = registered(t.app).filter((r) => !documented.has(r));
    expect(missing, `Endpoints with no entry in packages/contract/src/routes.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('lists no endpoint the server does not have', () => {
    const real = new Set(registered(t.app));
    const extra = ROUTES.map((r) => `${r.method} ${r.path}`).filter((r) => !real.has(r));
    expect(extra, `Documented but not on the server: ${extra.join(', ')}`).toEqual([]);
  });

  it('shows the developer endpoints only when the console is on', async () => {
    const off = await (await import('./helpers')).makeApp({ devConsole: false });
    const paths = registered(off.app);
    expect(paths).not.toContain('GET /dev');
    expect(paths).not.toContain('POST /api/dev/remind-now');
    await off.close();
  });

  it('answers 401 without credentials on every endpoint documented as protected', async () => {
    for (const r of ROUTES) {
      if (r.auth !== 'session' && r.auth !== 'device' && r.auth !== 'dev') continue;
      const path = r.path.replace(/:([a-z]+)/g, 'x');
      const res = await t.app.request(path, { method: r.method, headers: { origin: 'http://localhost:8080', 'content-type': 'application/json' }, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}' });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});
