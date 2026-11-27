/** Voice routes. The cloud speech and voice providers arrive in a later step; until a key is set they say so. */
import { Hono } from 'hono';
import type { VoiceStatus } from '@kaabil/contract';

export function voiceRoutes() {
  const app = new Hono();
  app.get('/status', (c) => {
    const status: VoiceStatus = { stt: 'key not set', tts: 'key not set' };
    return c.json(status);
  });
  return app;
}
