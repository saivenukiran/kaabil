/** Builds the Hono application from its dependencies, so tests can run the whole thing against an in-process database. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { Logger } from 'pino';
import { body, onError } from './http';
import { careRoutes } from './routes/care';
import { devRoutes } from './routes/dev';
import { deviceRoutes } from './routes/device';
import { voiceRoutes } from './routes/voice';
import type { Deps } from './types';

export const VERSION = '0.1.0';

export function createApp(d: Deps) {
  const app = new Hono<{ Variables: { log: Logger } }>();

  app.use('*', async (c, next) => {
    c.set('log', d.log);
    const t = Date.now();
    await next();
    // Method, path and status only: never a body, a name or a transcript.
    d.log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t }, 'request');
  });

  // The JSON API gets the strictest policy. The test console at /dev sets its own headers.
  app.use(
    '/api/*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      referrerPolicy: 'no-referrer',
      xFrameOptions: 'DENY',
      crossOriginResourcePolicy: 'same-origin',
      // HSTS only makes sense once the app is served over HTTPS; over plain HTTP it is ignored noise.
      strictTransportSecurity: d.config.baseUrl.startsWith('https://') ? 'max-age=31536000; includeSubDomains' : false,
    }),
  );
  // JSON bodies are small. Audio for speech recognition has its own, larger limit on its own route.
  app.use('/api/care/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json(body('too_large', 'That is too big'), 413) }));
  app.use('/api/device/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json(body('too_large', 'That is too big'), 413) }));
  app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', (c) => c.json({ ok: true as const, version: VERSION }));
  // Better Auth owns everything under /api/auth.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => d.auth.handler(c.req.raw));
  app.route('/api/care', careRoutes(d));
  app.route('/api/device', deviceRoutes(d));
  app.route('/api/voice', voiceRoutes());
  if (d.config.devConsole) app.route('/', devRoutes(d));

  app.notFound((c) => c.json(body('not_found', 'Not found'), 404));
  app.onError(onError);
  return app;
}
