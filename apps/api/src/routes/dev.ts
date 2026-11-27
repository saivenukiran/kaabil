/** Developer tools: the test console and "remind now". Mounted only when KAABIL_DEV_CONSOLE=1. */
import { Hono } from 'hono';
import { RemindNowSchema } from '@kaabil/contract';
import { allowedOrigins } from '../config';
import { HttpError, parseBody, unauthorized } from '../http';
import { requireMember } from '../repo';
import { originAllowed } from '../security';
import type { Deps } from '../types';
import { consoleHtml } from './consoleHtml';

export function devRoutes(d: Deps) {
  const app = new Hono();

  app.post('/api/dev/remind-now', async (c) => {
    if (!originAllowed(c.req.header('origin'), c.req.header('sec-fetch-site'), allowedOrigins(d.config))) throw new HttpError(403, 'bad_origin', 'This request did not come from the app');
    const s = await d.auth.api.getSession({ headers: c.req.raw.headers });
    if (!s) throw unauthorized();
    const v = await parseBody(c, RemindNowSchema);
    await requireMember(d.db, s.user.id, v.groupId);
    d.bus.publish(v.groupId, 'device', { type: 'remind', at: d.now(), ...(v.medicineId ? { medicineId: v.medicineId } : {}) });
    return c.json({ ok: true as const });
  });

  app.get('/dev', (c) => {
    c.header('Cache-Control', 'no-store');
    // The console is plain HTML with one inline script, so it needs its own, stricter-than-nothing policy.
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    return c.html(consoleHtml);
  });

  return app;
}
