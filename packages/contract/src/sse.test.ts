import { describe, expect, it } from 'vitest';
import { frameData, parseFrame, readStream, splitFrames, subscribe, type StreamStatus } from './sse';
import type { ServerEvent } from './schemas';

const enc = new TextEncoder();
function streamOf(...chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const x of chunks) c.enqueue(enc.encode(x));
        c.close();
      },
    }),
  );
}

describe('frames', () => {
  it('splits complete frames and keeps the unfinished rest', () => {
    const r = splitFrames('data: {"a":1}\n\ndata: {"b"');
    expect(r.frames).toEqual(['data: {"a":1}']);
    expect(r.rest).toBe('data: {"b"');
  });
  it('handles CRLF line endings', () => {
    expect(splitFrames('data: 1\r\n\r\n').frames).toEqual(['data: 1']);
  });
  it('ignores comment-only frames', () => {
    expect(frameData(': keep-alive')).toBeUndefined();
    expect(parseFrame(': keep-alive')).toBeUndefined();
  });
  it('drops an unknown or broken event instead of throwing', () => {
    expect(parseFrame('data: {"type":"explode","at":1}')).toBeUndefined();
    expect(parseFrame('data: not json')).toBeUndefined();
  });
  it('parses a known event', () => {
    expect(parseFrame('data: {"type":"ping","at":5}')).toEqual({ type: 'ping', at: 5 });
  });
});

describe('readStream', () => {
  it('delivers events even when a frame is split across chunks', async () => {
    const got: ServerEvent[] = [];
    await readStream(streamOf('data: {"type":"pi', 'ng","at":1}\n\n: hi\n\ndata: {"type":"ping","at":2}\n\n'), (e) => got.push(e), new AbortController().signal);
    expect(got).toEqual([
      { type: 'ping', at: 1 },
      { type: 'ping', at: 2 },
    ]);
  });
});

describe('subscribe', () => {
  it('reconnects after the stream ends, and stops when told', async () => {
    const ctl = new AbortController();
    const got: ServerEvent[] = [];
    const statuses: StreamStatus[] = [];
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      if (calls === 2) ctl.abort();
      return streamOf(`data: {"type":"ping","at":${calls}}\n\n`);
    }) as unknown as typeof fetch;
    await subscribe({ url: '/x', fetch: fakeFetch, signal: ctl.signal, onEvent: (e) => got.push(e), onStatus: (s) => statuses.push(s), retryMs: 1, maxDelayMs: 2 });
    expect(calls).toBe(2);
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(statuses.at(-1)).toBe('closed');
    expect(statuses).toContain('reconnecting');
  });
  it('does not retry when the server says not allowed', async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return new Response('no', { status: 401 });
    }) as unknown as typeof fetch;
    await subscribe({ url: '/x', fetch: fakeFetch, signal: new AbortController().signal, onEvent: () => undefined, retryMs: 1 });
    expect(calls).toBe(1);
  });
});
