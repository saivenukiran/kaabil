/**
 * A small server-sent-events reader built on fetch, not EventSource, because EventSource cannot
 * send an Authorization header and the person's phone authenticates with a device token.
 * Frames look like `data: {...}` followed by a blank line; lines that start with `:` are comments
 * (keep-alives) and are ignored.
 */
import { EventSchema, type ServerEvent } from './schemas';

/** Split a text buffer into complete frames and the unfinished rest. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, '\n');
  const parts = normalised.split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
}

/** The data payload of one frame, or undefined for a comment-only frame. */
export function frameData(frame: string): string | undefined {
  const data = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''));
  return data.length ? data.join('\n') : undefined;
}

/** Parse one frame into a validated event; anything that is not a known event is dropped. */
export function parseFrame(frame: string): ServerEvent | undefined {
  const data = frameData(frame);
  if (data === undefined) return undefined;
  try {
    const parsed = EventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SubscribeOptions {
  url: string;
  fetch: typeof fetch;
  headers?: Record<string, string>;
  signal: AbortSignal;
  onEvent: (e: ServerEvent) => void;
  onStatus?: (s: StreamStatus) => void;
  /** Delay before reconnecting, in ms. Doubles up to maxDelayMs. */
  retryMs?: number;
  maxDelayMs?: number;
}

/** Read one connection until it ends. Returns normally when the server closes the stream. */
export async function readStream(res: Response, onEvent: (e: ServerEvent) => void, signal: AbortSignal): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const f of frames) {
        const e = parseFrame(f);
        if (e) onEvent(e);
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Keep a stream open, reconnecting with a growing delay, until the signal aborts. */
export async function subscribe(o: SubscribeOptions): Promise<void> {
  const base = o.retryMs ?? 1000;
  const max = o.maxDelayMs ?? 10_000;
  let delay = base;
  while (!o.signal.aborted) {
    o.onStatus?.('connecting');
    try {
      const res = await o.fetch(o.url, { headers: { accept: 'text/event-stream', ...o.headers }, signal: o.signal });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        o.onStatus?.('closed'); // not allowed: retrying will not help
        return;
      }
      if (res.ok) {
        o.onStatus?.('open');
        delay = base;
        await readStream(res, o.onEvent, o.signal);
      }
    } catch {
      /* network drop or abort: handled below */
    }
    if (o.signal.aborted) break;
    o.onStatus?.('reconnecting');
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, max);
  }
  o.onStatus?.('closed');
}
