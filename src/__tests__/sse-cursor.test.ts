// sse-cursor.test.ts — unit tests for src/offline/sse-cursor.js
//
// jsdom does not implement EventSource (it is `undefined` in the test
// environment), so a small controllable fake stands in for it: each
// instance is captured in a module-scoped array so tests can reach in and
// fire onopen/onmessage/onerror by hand, exactly the events a real SSE
// connection would dispatch. This lets the cursor's reconnect/backoff and
// last-event-id tracking be driven deterministically without a real socket
// or a running server.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SseCursor } from '../offline/sse-cursor.js';

let instances: FakeEventSource[];

interface FakeMessageEvent {
  data: string;
  lastEventId?: string;
}

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  opts: unknown;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: FakeMessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  _listeners: Record<string, ((...args: unknown[]) => void)[]>;

  constructor(url: string, opts?: unknown) {
    this.url = url;
    this.opts = opts;
    this.readyState = FakeEventSource.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this._listeners = {};
    instances.push(this);
  }
  addEventListener(type: string, cb: (...args: unknown[]) => void) {
    (this._listeners[type] ??= []).push(cb);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  // ---- test helpers (not part of the real EventSource API) ----
  emitOpen() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }
  emitMessage(data: unknown, lastEventId?: string) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId });
  }
  emitError() {
    this.onerror?.(new Event('error'));
  }
}

beforeEach(() => {
  instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SseCursor — connection setup', () => {
  it('opens an EventSource against the given path immediately on construction', () => {
    const cursor = new SseCursor('/kds/stations/1/stream');
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toContain('/kds/stations/1/stream');
    cursor.close();
  });

  it('calls onOpen when the connection opens', () => {
    const onOpen = vi.fn();
    const cursor = new SseCursor('/stream', { onOpen });
    instances[0].emitOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
    cursor.close();
  });

  it('sends the initial cursor as ?since_event_id= when provided', () => {
    const cursor = new SseCursor('/stream', { initialCursor: 'evt-42' });
    expect(instances[0].url).toContain('since_event_id=evt-42');
    cursor.close();
  });

  it('sends no since_event_id on the very first connection when no initial cursor is given', () => {
    const cursor = new SseCursor('/stream');
    expect(instances[0].url).not.toContain('since_event_id');
    cursor.close();
  });
});

describe('SseCursor — message handling and cursor tracking', () => {
  it('invokes onMessage with the parsed JSON payload', () => {
    const onMessage = vi.fn();
    const cursor = new SseCursor('/stream', { onMessage });
    instances[0].emitMessage({ ticket_id: 'abc' }, 'evt-1');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toEqual({ ticket_id: 'abc' });
    cursor.close();
  });

  it('keeps the raw string when the payload is not JSON', () => {
    const onMessage = vi.fn();
    const cursor = new SseCursor('/stream', { onMessage });
    instances[0].emitMessage('plain text', 'evt-1');
    expect(onMessage.mock.calls[0][0]).toBe('plain text');
    cursor.close();
  });

  it('tracks lastEventId from each message', () => {
    const cursor = new SseCursor('/stream');
    instances[0].emitMessage({ a: 1 }, 'evt-1');
    expect(cursor.lastEventId).toBe('evt-1');
    instances[0].emitMessage({ a: 2 }, 'evt-2');
    expect(cursor.lastEventId).toBe('evt-2');
    cursor.close();
  });

  it('carries the cursor forward into the URL of the NEXT reconnect attempt', async () => {
    const cursor = new SseCursor('/stream');
    instances[0].emitMessage({ a: 1 }, 'evt-99');
    instances[0].emitError(); // triggers reconnect scheduling

    await vi.advanceTimersByTimeAsync(1000); // first backoff step (1s)

    expect(instances).toHaveLength(2);
    expect(instances[1].url).toContain('since_event_id=evt-99');
    cursor.close();
  });

  it('does not overwrite the cursor when a message carries no id', () => {
    const cursor = new SseCursor('/stream', { initialCursor: 'evt-keep' });
    instances[0].emitMessage({ a: 1 }, undefined);
    expect(cursor.lastEventId).toBe('evt-keep');
    cursor.close();
  });
});

describe('SseCursor — reconnect backoff', () => {
  it('reconnects after an error, waiting the first backoff step', async () => {
    const cursor = new SseCursor('/stream');
    instances[0].emitError();
    expect(instances).toHaveLength(1); // not yet — still waiting on the timer

    await vi.advanceTimersByTimeAsync(999);
    expect(instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(instances).toHaveLength(2);
    cursor.close();
  });

  it('resets the backoff attempt counter after a successful open', async () => {
    const cursor = new SseCursor('/stream');
    instances[0].emitError();
    await vi.advanceTimersByTimeAsync(1000); // reconnect #2 after 1s (attempt 0)
    instances[1].emitError();
    await vi.advanceTimersByTimeAsync(2000); // reconnect #3 after 2s (attempt 1)
    instances[2].emitOpen(); // success resets attempt to 0

    instances[2].emitError();
    // Backoff should restart from the FIRST step (1s), not continue at 4s.
    await vi.advanceTimersByTimeAsync(1000);
    expect(instances).toHaveLength(4);
    cursor.close();
  });

  it('calls onError on every failed connection', () => {
    const onError = vi.fn();
    const cursor = new SseCursor('/stream', { onError });
    instances[0].emitError();
    expect(onError).toHaveBeenCalledTimes(1);
    cursor.close();
  });

  it('stops reconnecting once close() has been called', async () => {
    const cursor = new SseCursor('/stream');
    cursor.close();
    instances[0].emitError(); // a stray late error from the closed source
    await vi.advanceTimersByTimeAsync(60000);
    expect(instances).toHaveLength(1); // no reconnect attempted
  });
});

describe('SseCursor — token fallback on auth rejection', () => {
  it('sends an explicit token from the very first connection, before any error', () => {
    const cursor = new SseCursor('/stream', { token: 'my-token' });
    expect(instances[0].url).toContain('token=my-token');
    cursor.close();
  });

  it('switches to reading a stored token if the very first connection never opens (no explicit token)', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'stored-token' }));
    const cursor = new SseCursor('/stream'); // no explicit token
    expect(instances[0].url).not.toContain('token=');

    // No emitOpen() — the connection fails before ever opening, which is
    // the signal sse-cursor.js uses to suspect a cookie-auth rejection.
    instances[0].emitError();
    await vi.advanceTimersByTimeAsync(1000);

    expect(instances).toHaveLength(2);
    expect(instances[1].url).toContain('token=stored-token');
    cursor.close();
  });

  it('does NOT switch to token fallback once the connection has opened at least once', async () => {
    const cursor = new SseCursor('/stream'); // no explicit token, no stored token
    instances[0].emitOpen();
    instances[0].emitError();
    await vi.advanceTimersByTimeAsync(1000);

    expect(instances[1].url).not.toContain('token=');
    cursor.close();
  });
});

describe('SseCursor — close()', () => {
  it('closes the underlying EventSource', () => {
    const cursor = new SseCursor('/stream');
    const es = instances[0];
    expect(es.readyState).not.toBe(FakeEventSource.CLOSED);
    cursor.close();
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('is safe to call twice', () => {
    const cursor = new SseCursor('/stream');
    expect(() => {
      cursor.close();
      cursor.close();
    }).not.toThrow();
  });
});
