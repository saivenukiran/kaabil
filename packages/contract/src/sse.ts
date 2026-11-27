/**
 * A small server-sent-events reader built on fetch, not EventSource, because EventSource cannot
 * send an Authorization header and the person's phone authenticates with a device token.
 * Frames look like `data: {...}` followed by a blank line; lines that start with `:` are comments
 * (keep-alives) and are ignored.
 */
import { EventSchema, PollResultSchema, type ServerEvent } from './schemas';

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
  if (signal.aborted) {
    await reader.cancel().catch(() => undefined); // cancelled before it began: an abort event will not fire again
    return;
  }
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

export interface LiveOptions extends SubscribeOptions {
  /** The address that answers "what happened after `after`?", waiting up to `waitMs`. `after` is undefined on the first call. */
  pollUrl: (after: number | undefined, waitMs: number) => string;
  /** If a stream has delivered nothing (not even its first ping) after this long, a proxy is holding it back: switch to polling. */
  firstEventMs?: number;
  /** How long one poll may wait for news. */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Live events by the best way that works. It opens the stream first; the server sends a ping the moment
 * a stream opens, so silence means something between us and the server (a Cloudflare quick tunnel, some
 * proxies) is holding the stream back. Then it asks instead: long polling, which is an ordinary request and
 * gets through anything. Both deliver the same events.
 */
export async function live(o: LiveOptions): Promise<void> {
  // Note where the news stands before anything else, so that if the stream turns out to be held back, what
  // happened in the meantime is still there to be fetched (the server keeps the last events of each group).
  const start = startingPoint(o);
  const streamCtl = new AbortController();
  const stop = () => streamCtl.abort();
  o.signal.addEventListener('abort', stop);
  let heard = false;
  const watchdog = setTimeout(() => {
    if (!heard) streamCtl.abort();
  }, o.firstEventMs ?? 3000);
  await subscribe({
    ...o,
    signal: streamCtl.signal,
    onEvent: (e) => {
      heard = true;
      clearTimeout(watchdog);
      o.onEvent(e);
    },
  });
  clearTimeout(watchdog);
  o.signal.removeEventListener('abort', stop);
  if (o.signal.aborted || heard) return; // finished, or the stream worked and then was refused
  await poll(o, await start);
}

/** The server's current position in the news, or undefined if it cannot be asked. Never throws. */
async function startingPoint(o: LiveOptions): Promise<number | undefined> {
  try {
    const res = await o.fetch(o.pollUrl(undefined, 0), { headers: o.headers, signal: o.signal });
    if (!res.ok) return undefined;
    const parsed = PollResultSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.last : undefined;
  } catch {
    return undefined;
  }
}

/** Long polling until the signal aborts, or the server says this client is not allowed. `start` is where to continue from. */
export async function poll(o: LiveOptions, start?: number): Promise<void> {
  const base = o.retryMs ?? 1000;
  const max = o.maxDelayMs ?? 10_000;
  const waitMs = o.waitMs ?? 8000;
  let cursor: number | undefined = start;
  let delay = base;
  o.onStatus?.('connecting');
  while (!o.signal.aborted) {
    try {
      const res = await o.fetch(o.pollUrl(cursor, cursor === undefined ? 0 : waitMs), { headers: o.headers, signal: o.signal });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        o.onStatus?.('closed'); // not allowed: asking again will not help
        return;
      }
      if (res.ok) {
        const parsed = PollResultSchema.safeParse(await res.json());
        if (parsed.success) {
          // Only events newer than the cursor count, so a server that repeats itself cannot make this loop spin or deliver twice.
          const fresh = parsed.data.events.filter((e) => cursor === undefined || e.id > cursor);
          cursor = Math.max(cursor ?? 0, parsed.data.last);
          delay = base;
          o.onStatus?.('open');
          for (const e of fresh) o.onEvent(e.event);
          if (!fresh.length) await sleep(250); // a server that answers at once with nothing new must not be hammered
          continue;
        }
      }
    } catch {
      /* network drop or abort: handled below */
    }
    if (o.signal.aborted) break;
    o.onStatus?.('reconnecting');
    await sleep(delay);
    delay = Math.min(delay * 2, max);
  }
  o.onStatus?.('closed');
}
