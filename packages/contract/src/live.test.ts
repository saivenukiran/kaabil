import { describe, expect, it } from 'vitest';
import { live, type StreamStatus } from './sse';
import type { ServerEvent } from './schemas';

const enc = new TextEncoder();
/** A live stream that opens fine and then says nothing, like one held back by a proxy. */
const silentStream = () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } });
const workingStream = () =>
  new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode('data: {"type":"ping","at":1}\n\n')), c.enqueue(enc.encode('data: {"type":"plan","at":2}\n\n'))) }), { headers: { 'content-type': 'text/event-stream' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const plan = (at: number): ServerEvent => ({ type: 'plan', at });
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(respond: (url: string, n: number) => Response | Promise<Response>) {
  const urls: string[] = [];
  const events: ServerEvent[] = [];
  const statuses: StreamStatus[] = [];
  const ctl = new AbortController();
  let n = 0;
  const fetchFn = (async (input: string) => {
    urls.push(input);
    return respond(input, n++);
  }) as unknown as typeof fetch;
  const run = live({
    url: '/events',
    fetch: fetchFn,
    signal: ctl.signal,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    pollUrl: (after, wait) => (after === undefined ? '/poll' : `/poll?after=${after}&wait=${wait}`),
    firstEventMs: 40,
    retryMs: 5,
    maxDelayMs: 10,
    waitMs: 1,
  });
  return { urls, events, statuses, ctl, run };
}

describe('live events when the stream is held back', () => {
  it('switches to polling after the stream stays silent, and delivers what the polls return, in order', async () => {
    let poll = 0;
    const h = harness((url) => {
      if (url === '/events') return silentStream();
      poll += 1;
      if (url === '/poll') return json({ events: [], last: 10 }); // the starting point
      if (poll === 2) return json({ events: [{ id: 11, event: plan(1) }, { id: 12, event: plan(2) }], last: 12 });
      return json({ events: [], last: 12 });
    });
    await tick(400);
    h.ctl.abort();
    await h.run;
    expect(h.events).toEqual([plan(1), plan(2)]);
    expect(h.urls[0]).toBe('/events');
    expect(h.urls).toContain('/poll'); // the first poll asks for the starting point
    expect(h.urls).toContain('/poll?after=10&wait=1'); // then continues from it
    expect(h.urls).toContain('/poll?after=12&wait=1'); // and from the newest id it has seen
    expect(h.statuses).toContain('open');
    expect(h.statuses.at(-1)).toBe('closed');
  });

  it('keeps the stream and never polls when the stream works', async () => {
    const h = harness((url) => (url === '/events' ? workingStream() : json({ events: [], last: 0 })));
    await tick(150);
    h.ctl.abort();
    await h.run;
    expect(h.events.map((e) => e.type)).toEqual(['ping', 'plan']);
    expect(h.urls.every((u) => u === '/events')).toBe(true);
  });

  it('stops quietly when the server refuses this client while polling', async () => {
    const h = harness((url) => (url === '/events' ? silentStream() : json({ error: { code: 'unauthorized', message: 'no' } }, 401)));
    await h.run; // returns by itself: asking again would not help
    expect(h.statuses.at(-1)).toBe('closed');
    expect(h.urls.filter((u) => u.startsWith('/poll'))).toHaveLength(1);
  });

  it('keeps asking after a network error, and after an answer it does not understand', async () => {
    let polls = 0;
    const h = harness((url) => {
      if (url === '/events') return silentStream();
      polls += 1;
      if (polls === 1) return json({ events: [], last: 5 });
      if (polls === 2) throw new Error('connection reset');
      if (polls === 3) return json({ nonsense: true });
      return json({ events: [{ id: 6, event: plan(7) }], last: 6 });
    });
    await tick(500);
    h.ctl.abort();
    await h.run;
    expect(h.events).toEqual([plan(7)]);
    expect(h.statuses).toContain('reconnecting');
  });

  it('does not deliver the same event twice, and does not spin, when a server keeps repeating itself', async () => {
    let polls = 0;
    const h = harness((url) => {
      if (url === '/events') return silentStream();
      polls += 1;
      if (polls === 1) return json({ events: [], last: 5 });
      return json({ events: [{ id: 6, event: plan(7) }], last: 6 }); // the same answer every time
    });
    await tick(600);
    h.ctl.abort();
    await h.run;
    expect(h.events).toEqual([plan(7)]);
    expect(polls).toBeLessThan(20); // paused between asks instead of looping
  });

  it('drops an event it does not know instead of failing', async () => {
    let polls = 0;
    const h = harness((url) => {
      if (url === '/events') return silentStream();
      polls += 1;
      if (polls === 1) return json({ events: [], last: 1 });
      return json({ events: [{ id: 2, event: { type: 'explode', at: 1 } }], last: 2 });
    });
    await tick(250);
    h.ctl.abort();
    await h.run;
    expect(h.events).toEqual([]);
  });

  it('stops at once when the caller closes it, even while the stream is still silent', async () => {
    const h = harness((url) => (url === '/events' ? silentStream() : json({ events: [], last: 0 })));
    await tick(10);
    h.ctl.abort();
    await h.run;
    expect(h.urls.filter((u) => u.startsWith('/poll'))).toHaveLength(0);
  });
});
