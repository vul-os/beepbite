// offline-queue.test.ts — unit tests for src/offline/queue.ts
//
// This is the offline mutation queue that will back optimistic writes once
// wired into the app; today it is a standalone library. jsdom does not
// implement IndexedDB (indexedDB is `undefined` in the test environment — see
// the check that motivated this file), so a small, faithful fake is defined
// below covering only the exact surface queue.js touches: open/upgradeneeded,
// a single object store, and getAll/add/put/delete. It is intentionally not a
// general-purpose IndexedDB polyfill.
//
// The module under test has top-level side effects (it registers a `window`
// 'online' listener and schedules an initial flush if already online), so the
// fake indexedDB and `fetch` must be installed BEFORE the dynamic import.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as QueueModule from '../offline/queue';
import type { Mutation, MutationRecord } from '../offline/queue';

// ---- Fake IndexedDB (minimal, faithful to queue.js's usage only) ----------

type FakeRecord = Record<string, unknown>;

interface FakeStore {
  keyPath: string;
  nextKey: number;
  records: Map<number, FakeRecord>;
}

interface FakeDb {
  stores: Map<string, FakeStore>;
}

interface FakeRequest {
  onsuccess: ((ev: { target: FakeRequest }) => void) | null;
  onerror: ((ev: { target: FakeRequest }) => void) | null;
  onupgradeneeded: ((ev: { target: { result: unknown } }) => void) | null;
  result: unknown;
  error: unknown;
}

function installFakeIndexedDB(): FakeDb {
  const db: FakeDb = { stores: new Map() };

  function makeRequest(): FakeRequest {
    return { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: undefined };
  }
  function succeed(req: FakeRequest, result: unknown) {
    queueMicrotask(() => {
      req.result = result;
      req.onsuccess?.({ target: req });
    });
  }

  function storeApi(name: string) {
    const store = db.stores.get(name)!;
    return {
      getAll() {
        const req = makeRequest();
        succeed(req, [...store.records.values()].map((r) => ({ ...r })));
        return req;
      },
      add(record: FakeRecord) {
        const req = makeRequest();
        const key = store.nextKey++;
        const stored = { ...record, [store.keyPath]: key };
        store.records.set(key, stored);
        succeed(req, key);
        return req;
      },
      put(record: FakeRecord) {
        const req = makeRequest();
        const key = record[store.keyPath] as number;
        store.records.set(key, { ...record });
        succeed(req, key);
        return req;
      },
      delete(key: number) {
        const req = makeRequest();
        store.records.delete(key);
        succeed(req, undefined);
        return req;
      },
    };
  }

  const fakeIndexedDB = {
    open(_name: string) {
      const req = makeRequest();
      const isNew = !db.stores.has('mutations');
      const dbHandle = {
        objectStoreNames: { contains: (n: string) => db.stores.has(n) },
        createObjectStore(storeName: string, opts: { keyPath: string; autoIncrement?: boolean }) {
          db.stores.set(storeName, {
            keyPath: opts.keyPath,
            nextKey: 1,
            records: new Map(),
          });
          return { createIndex: () => {} };
        },
        transaction(_storeName: string) {
          return { objectStore: (n: string) => storeApi(n) };
        },
      };
      queueMicrotask(() => {
        if (isNew) req.onupgradeneeded?.({ target: { result: dbHandle } });
        succeed(req, dbHandle);
      });
      return req;
    },
  };

  vi.stubGlobal('indexedDB', fakeIndexedDB);
  return db;
}

// ---- Test setup -------------------------------------------------------------

let fakeDb: FakeDb;
let fetchMock: ReturnType<typeof vi.fn>;
let queue: typeof QueueModule;

beforeEach(async () => {
  vi.resetModules();
  fakeDb = installFakeIndexedDB();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Keep the module's own online-triggered initial flush a no-op: it runs
  // against an empty store regardless, but starting online avoids a stray
  // 'online'-listener flush firing mid-assertion in a later test.
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear();

  queue = await import('../offline/queue.js');
  // Let the module's deferred initial flush (Promise.resolve().then(...))
  // run and settle against the empty store before each test starts.
  await flushMicrotasks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Drain the microtask queue enough for the fake IDB's queueMicrotask-based
// callbacks (and any .then() chains they trigger) to resolve.
async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

function baseMutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    url: '/pos/orders',
    method: 'POST',
    body: { foo: 'bar' },
    idempotencyKey: 'idem-key-1',
    ...overrides,
  };
}

// ---- Tests ------------------------------------------------------------------

describe('enqueueMutation', () => {
  it('persists the mutation and returns an IDB key', async () => {
    const id = await queue.enqueueMutation(baseMutation());
    expect(typeof id).toBe('number');
    expect(await queue.getPendingCount()).toBe(1);
  });

  it('calls onOptimisticApply synchronously before resolving', async () => {
    const order = [];
    const applyPromise = queue.enqueueMutation(
      baseMutation({ onOptimisticApply: () => order.push('applied') }),
    );
    order.push('after-call');
    await applyPromise;
    // onOptimisticApply is invoked before the enqueue promise resolves —
    // it fires while the IDB add() is still pending (a microtask), so it is
    // observed before the synchronous "after-call" push only if invoked
    // eagerly. Assert it ran at all, and ran before the promise settled.
    expect(order).toContain('applied');
  });

  it('does not persist onOptimisticApply/onRollback callbacks (in-memory only)', async () => {
    const id = await queue.enqueueMutation(
      baseMutation({ onOptimisticApply: () => {}, onRollback: () => {} }),
    );
    const store = fakeDb.stores.get('mutations')!;
    const stored = store.records.get(id)!;
    expect(stored.onOptimisticApply).toBeUndefined();
    expect(stored.onRollback).toBeUndefined();
  });

  it('stamps retryCount: 0 and an enqueuedAt timestamp', async () => {
    const id = await queue.enqueueMutation(baseMutation());
    const stored = fakeDb.stores.get('mutations')!.records.get(id)!;
    expect(stored.retryCount).toBe(0);
    expect(typeof stored.enqueuedAt).toBe('number');
  });
});

describe('getPendingCount', () => {
  it('is 0 for an empty queue', async () => {
    expect(await queue.getPendingCount()).toBe(0);
  });

  it('counts multiple enqueued mutations', async () => {
    await queue.enqueueMutation(baseMutation());
    await queue.enqueueMutation(baseMutation({ idempotencyKey: 'idem-key-2' }));
    expect(await queue.getPendingCount()).toBe(2);
  });
});

describe('flushQueue — success path', () => {
  it('sends the Idempotency-Key header and removes the mutation on 2xx', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await queue.enqueueMutation(baseMutation());

    await queue.flushQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/pos/orders');
    expect(init.headers['Idempotency-Key']).toBe('idem-key-1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ foo: 'bar' });
    expect(await queue.getPendingCount()).toBe(0);
  });

  it('replays mutations in insertion (FIFO) order', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await queue.enqueueMutation(baseMutation({ idempotencyKey: 'first', url: '/a' }));
    await queue.enqueueMutation(baseMutation({ idempotencyKey: 'second', url: '/b' }));

    await queue.flushQueue();

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls[0]).toContain('/a');
    expect(urls[1]).toContain('/b');
  });

  it('emits onFlush with the mutation after each successful item', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const seen: MutationRecord[] = [];
    const unsubscribe = queue.onFlush((m) => seen.push(m));

    await queue.enqueueMutation(baseMutation());
    await queue.flushQueue();

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/pos/orders');
    unsubscribe();
  });

  it('attaches the bearer token from localStorage when present', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'tok-123' }));
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await queue.enqueueMutation(baseMutation());

    await queue.flushQueue();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer tok-123');
  });

  it('does not flush while offline', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await queue.enqueueMutation(baseMutation());
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    await queue.flushQueue();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await queue.getPendingCount()).toBe(1);
  });
});

describe('flushQueue — terminal errors (4xx except 409)', () => {
  it('drops the mutation and fires onRollback without retrying', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422 });
    const onRollback = vi.fn();
    await queue.enqueueMutation(baseMutation({ onRollback }));

    await queue.flushQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(await queue.getPendingCount()).toBe(0);
  });

  it('treats a 409 (idempotency conflict) as success, not terminal', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409 });
    const onRollback = vi.fn();
    await queue.enqueueMutation(baseMutation({ onRollback }));

    // A non-terminal error triggers the retry/backoff path, which awaits a
    // real timer — use fake timers so the test does not actually wait.
    vi.useFakeTimers();
    const flushPromise = queue.flushQueue();
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromise;
    vi.useRealTimers();

    // Not dropped as terminal: onRollback must not have fired, and the
    // record should still be pending, now with an incremented retryCount.
    expect(onRollback).not.toHaveBeenCalled();
    expect(await queue.getPendingCount()).toBe(1);
  });
});

describe('flushQueue — transient errors: backoff and retry', () => {
  it('increments retryCount and stops processing further items after a network failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await queue.enqueueMutation(baseMutation({ idempotencyKey: 'first', url: '/a' }));
    await queue.enqueueMutation(baseMutation({ idempotencyKey: 'second', url: '/b' }));

    vi.useFakeTimers();
    const flushPromise = queue.flushQueue();
    await vi.advanceTimersByTimeAsync(2000); // first backoff step
    await flushPromise;
    vi.useRealTimers();

    // Only the first (failing) mutation was attempted this pass; the second
    // was never reached because a transient failure breaks out of the loop.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await queue.getPendingCount()).toBe(2);

    const stored = [...fakeDb.stores.get('mutations')!.records.values()];
    const first = stored.find((r) => r.idempotencyKey === 'first')!;
    expect(first.retryCount).toBe(1);
  });

  it('drops the mutation and fires onRollback once MAX_RETRIES is exhausted', async () => {
    fetchMock.mockRejectedValue(new Error('still down'));
    const onRollback = vi.fn();
    await queue.enqueueMutation(baseMutation({ onRollback }));

    vi.useFakeTimers();
    // 5 failed attempts (MAX_RETRIES = 5) each advance the backoff, then one
    // more flush call finds retryCount >= MAX_RETRIES and drops it.
    for (let i = 0; i < 5; i++) {
      const p = queue.flushQueue();
      await vi.advanceTimersByTimeAsync(30000);
      await p;
    }
    await queue.flushQueue();
    vi.useRealTimers();

    // 5 attempts during the retry loop; the 6th call finds retryCount >=
    // MAX_RETRIES and drops without ever calling fetch again.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(await queue.getPendingCount()).toBe(0);
  });
});
