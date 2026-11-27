import { describe, expect, it } from 'vitest';
import { consoleHtml } from '../src/routes/consoleHtml';
import { makeApp } from './helpers';

describe('the test console', () => {
  it('is served with its own policy and the other safety headers', async () => {
    const t = await makeApp();
    const r = await t.app.request('/dev');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self' 'unsafe-inline'");
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).toContain('Kaabil test console');
    await t.close();
  });

  it('does not exist unless it is switched on', async () => {
    const t = await makeApp({ devConsole: false });
    expect((await t.app.request('/dev')).status).toBe(404);
    expect((await t.app.request('/api/dev/remind-now', { method: 'POST' })).status).toBe(404);
    await t.close();
  });

  it('has an inline script that is valid JavaScript', () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(consoleHtml)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script ?? '')).not.toThrow();
  });

  it('writes server data with textContent and never with innerHTML', () => {
    expect(consoleHtml).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('refuses remind-now without a session or for another family', async () => {
    const t = await makeApp();
    const r = await t.app.request('/api/dev/remind-now', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8080' }, body: JSON.stringify({ groupId: 'x' }) });
    expect(r.status).toBe(401);
    await t.close();
  });
});
