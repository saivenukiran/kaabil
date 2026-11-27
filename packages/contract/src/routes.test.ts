import { describe, expect, it } from 'vitest';
import { createClient } from './client';
import { AUTH_ENDPOINTS, CLIENT_CALLS, ROUTES } from './routes';

const paramsOf = (path: string) => [...path.matchAll(/:([a-z]+)/g)].map((m) => m[1]!);

describe('the route list', () => {
  it('has no endpoint twice', () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('documents exactly the path parameters each path has', () => {
    for (const r of ROUTES) {
      expect(Object.keys(r.params ?? {}).sort(), `${r.method} ${r.path}`).toEqual(paramsOf(r.path).sort());
    }
  });

  it('gives every request example that is valid against its own schema', () => {
    for (const r of ROUTES) {
      if (r.request && 'schema' in r.request) {
        const parsed = r.request.schema.safeParse(r.request.example);
        // examples hold placeholders such as MEDICINE_ID; they must still have the right shape
        expect(parsed.success, `${r.method} ${r.path}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      }
    }
  });

  it('says who may call each endpoint and what it answers on success', () => {
    for (const r of ROUTES) {
      expect(['none', 'session', 'device', 'dev']).toContain(r.auth);
      expect(r.summary.length, r.path).toBeGreaterThan(5);
      expect([200, 201, 204]).toContain(r.status);
    }
  });

  it('lists the errors that authentication can cause on every protected endpoint', () => {
    for (const r of ROUTES) {
      const statuses = (r.errors ?? []).map((e) => e.status);
      if (r.auth === 'session' || r.auth === 'dev') expect(statuses, `${r.method} ${r.path}`).toContain(401);
      if (r.auth === 'device') expect(statuses, `${r.method} ${r.path}`).toContain(401);
      // anything that changes data with a cookie is also protected by the origin check
      if ((r.auth === 'session' || r.auth === 'dev') && r.method !== 'GET') expect(statuses, `${r.method} ${r.path}`).toContain(403);
    }
  });

  it('keeps paths in the places the server mounts them', () => {
    for (const r of ROUTES) expect(r.path.startsWith('/api/') || r.path === '/dev', r.path).toBe(true);
    for (const r of ROUTES) if (r.auth === 'device') expect(r.path.startsWith('/api/device/'), r.path).toBe(true);
  });

  it('lists the Better Auth endpoints the apps use', () => {
    expect(AUTH_ENDPOINTS.map((e) => e.path)).toEqual(['/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/get-session']);
  });
});

describe('the client calls shown in the documentation', () => {
  it('belong to listed endpoints, and every JSON endpoint has one except the page', () => {
    const keys = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    for (const k of Object.keys(CLIENT_CALLS)) expect(keys.has(k), k).toBe(true);
    for (const r of ROUTES) if (r.path !== '/dev') expect(CLIENT_CALLS[`${r.method} ${r.path}`], `${r.method} ${r.path}`).toBeTruthy();
  });

  it('are real functions on the typed client', () => {
    const client = createClient() as unknown as Record<string, unknown>;
    for (const call of Object.values(CLIENT_CALLS)) {
      const path = /^client\.([A-Za-z.]+)\(/.exec(call)?.[1]?.split('.') ?? [];
      let at: unknown = client;
      for (const part of path) at = (at as Record<string, unknown> | undefined)?.[part];
      expect(typeof at, call).toBe('function');
    }
  });
});
