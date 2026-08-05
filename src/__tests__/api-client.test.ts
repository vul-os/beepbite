// api-client.test.ts — unit tests for src/lib/api-client.ts
//
// This is the one fetch wrapper every service module in src/services goes
// through: token attachment, the 401-refresh-and-replay dance, the
// missing_capability manager-override retry, and the supabase-js-shaped
// query builder (including its embedded-join resolver) all live here and
// were previously completely untested. A regression in any of these is not
// cosmetic — it is "staff can no longer check out an order" or "a refreshed
// session silently loses auth".
//
// Each test gets a FRESH module instance (vi.resetModules() + dynamic
// import) because the module keeps mutable top-level state (auth listeners,
// the registered manager-override handler, the in-flight refresh promise)
// that must not leak between tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function jsonResponse(body: unknown, { status = 200, statusText = '' }: { status?: number; statusText?: string } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    // Promise.resolve(), not `async`: no await needed in the body, but
    // these have to stay Promise-returning to faithfully mock the real
    // (inherently async) Response.text()/.json().
    text: () => Promise.resolve(JSON.stringify(body)),
    // refreshIfNeeded() calls res.json() directly rather than going through
    // the text()-then-JSON.parse path request() uses everywhere else.
    json: () => Promise.resolve(body),
  };
}

function textResponse(str: string, { status = 200, statusText = '' }: { status?: number; statusText?: string } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(str),
  };
}

function noContentResponse() {
  return { ok: true, status: 204, statusText: 'No Content', text: () => Promise.resolve('') };
}

// Row shape returned by the embedded-join test's mocked /data/orders response,
// used only to give `.find()` a typed callback below (the Builder's result
// type is `any` by design — see api-client.ts).
interface OrderRowWithEmbeds {
  id: string;
  customer_id?: string | null;
  customers?: { id: string; name: string } | null;
  order_items?: { id: string; order_id: string; qty: number }[];
}

let fetchMock: ReturnType<typeof vi.fn>;
let api: typeof import('../lib/api-client')['api'];
let supabase: typeof import('../lib/api-client')['supabase'];
let onMissingCapability: typeof import('../lib/api-client')['onMissingCapability'];
let registerManagerOverrideHandler: typeof import('../lib/api-client')['registerManagerOverrideHandler'];

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const mod = await import('../lib/api-client.js');
  api = mod.api;
  supabase = mod.supabase;
  onMissingCapability = mod.onMissingCapability;
  registerManagerOverrideHandler = mod.registerManagerOverrideHandler;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCallUrl() {
  return new URL(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0], 'http://x');
}

// ---------------------------------------------------------------------------
// request() — basic shaping
// ---------------------------------------------------------------------------

describe('api.request — basic response shaping', () => {
  it('returns { data, error: null } for a 2xx JSON response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: '1' }));
    const { data, error } = await api.request('GET', '/data/orders');
    expect(error).toBeNull();
    expect(data).toEqual({ id: '1' });
  });

  it('returns { data: null, error: null } for a 204 No Content response, without parsing a body', async () => {
    fetchMock.mockResolvedValueOnce(noContentResponse());
    const { data, error } = await api.request('DELETE', '/data/orders/1');
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('always sends Content-Type: application/json and JSON-stringifies the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await api.request('POST', '/pos/orders', { body: { item_id: 'x', qty: 2 } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ item_id: 'x', qty: 2 });
  });

  it('sends no body when none is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await api.request('GET', '/data/orders');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it('attaches the bearer token from localStorage by default', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'tok-abc' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await api.request('GET', '/data/orders');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
  });

  it('omits Authorization when auth: false is passed', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'tok-abc' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await api.request('GET', '/track/tok', { auth: false });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('treats an unparseable JSON body as a raw string payload rather than throwing', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' }));
    const { data, error } = await api.request('GET', '/data/orders');
    expect(data).toBeNull();
    // payload.error is undefined on a bare string, so it falls back to statusText.
    expect(error?.message).toBe('Bad Gateway');
    expect(error?.status).toBe(502);
  });

  it('surfaces the backend error message and status on a non-2xx JSON response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'insufficient stock' }, { status: 409 }));
    const { data, error } = await api.request('POST', '/pos/orders', { body: {} });
    expect(data).toBeNull();
    expect(error).toEqual({ message: 'insufficient stock', status: 409, capability: undefined });
  });
});

// ---------------------------------------------------------------------------
// request() — 401 refresh-and-replay
// ---------------------------------------------------------------------------

describe('api.request — 401 auto-refresh and replay', () => {
  it('refreshes the session once and replays the original request on success', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'stale', refresh_token: 'rt-1' }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { status: 401 })) // original
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh', refresh_token: 'rt-2' })) // refresh
      .mockResolvedValueOnce(jsonResponse({ id: 'order-1' })); // replay

    const { data, error } = await api.request('GET', '/data/orders/1');

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'order-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The refresh call hits /auth/refresh with the stored refresh_token.
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1];
    expect(refreshUrl).toContain('/auth/refresh');
    expect(JSON.parse(refreshInit.body)).toEqual({ refresh_token: 'rt-1' });

    // The new session is persisted.
    const stored = JSON.parse(localStorage.getItem('bb.auth')!);
    expect(stored.access_token).toBe('fresh');

    // The replayed request carries the NEW access token.
    const [, replayInit] = fetchMock.mock.calls[2];
    expect(replayInit.headers.Authorization).toBe('Bearer fresh');
  });

  it('does not attempt a refresh when there is no refresh_token stored', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'stale' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { status: 401 }));

    const { error } = await api.request('GET', '/data/orders/1');

    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt, no replay
    expect(error?.status).toBe(401);
  });

  it('clears the stored session and does not replay when the refresh itself fails', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'stale', refresh_token: 'rt-1' }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { status: 401 })) // original
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid refresh token' }, { status: 401 })); // refresh fails

    const { data, error } = await api.request('GET', '/data/orders/1');

    expect(fetchMock).toHaveBeenCalledTimes(2); // no third (replay) call
    expect(data).toBeNull();
    expect(error?.status).toBe(401);
    expect(localStorage.getItem('bb.auth')).toBeNull();
  });

  it('does not attempt a refresh for a 401 when auth: false was passed (a public endpoint)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad token' }, { status: 401 }));
    await api.request('GET', '/track/expired-token', { auth: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent 401s into a single refresh call', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'stale', refresh_token: 'rt-1' }));
    // fetchMock is `vi.fn()` with no type argument, so mockImplementation's
    // parameter resolves to a void-returning shape here even though its
    // return is only ever consumed as `any` at runtime by `raw()`. Retyping
    // fetchMock against the real global `fetch` was tried and reverted: it
    // requires every mock response object in this file (jsonResponse/
    // textResponse/noContentResponse) to implement the full Response
    // interface (headers, redirected, type, url, ...) and every call site
    // to model RequestInit precisely, which is disproportionate test-
    // fixture rework for a mock that only ever needs { ok, status,
    // statusText, text() } — not a real bug in application code.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ access_token: 'fresh', refresh_token: 'rt-2' }));
      }
      // Every non-refresh call is 401 until the token in the store is 'fresh'.
      const stored = JSON.parse(localStorage.getItem('bb.auth') || '{}');
      if (stored.access_token === 'fresh') return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse({ error: 'expired' }, { status: 401 }));
    });

    const [r1, r2] = await Promise.all([
      api.request('GET', '/data/a'),
      api.request('GET', '/data/b'),
    ]);

    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// request() — 403 missing_capability
// ---------------------------------------------------------------------------

describe('api.request — 403 missing_capability', () => {
  it('emits onMissingCapability with the capability name when no override handler is registered', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'missing_capability', capability: 'can_void' }, { status: 403 }),
    );
    const seen: string[] = [];
    const unsubscribe = onMissingCapability((cap) => seen.push(cap));

    const { data, error } = await api.request('POST', '/orders/1/void', { body: {} });

    expect(data).toBeNull();
    expect(error?.capability).toBe('can_void');
    expect(seen).toEqual(['can_void']);
    unsubscribe();
  });

  it('retries once with an X-Actor-Token when a manager-override handler approves', async () => {
    const handler = vi.fn().mockResolvedValue('one-shot-token');
    registerManagerOverrideHandler(handler);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'missing_capability', capability: 'can_comp' }, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const { data, error } = await api.request('POST', '/orders/1/items/2/comp', { body: {} });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({ capability: 'can_comp', reason: 'can comp' });

    const [, replayInit] = fetchMock.mock.calls[1];
    expect(replayInit.headers['X-Actor-Token']).toBe('one-shot-token');
  });

  it('falls through to a normal error when the handler declines (returns falsy)', async () => {
    // Promise.resolve(), not `async`: no await needed, but
    // ManagerOverrideHandler's type requires a Promise return.
    registerManagerOverrideHandler(() => Promise.resolve(null));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'missing_capability', capability: 'can_void' }, { status: 403 }),
    );

    const { error } = await api.request('POST', '/orders/1/void', { body: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1); // no replay attempted
    expect(error?.capability).toBe('can_void');
  });

  it('falls through to a normal error when the handler throws (user cancelled the PIN prompt)', async () => {
    // Not async: a function that always throws infers as `never`, which is
    // assignable anywhere — including where ManagerOverrideHandler's
    // Promise return is expected — without needing to wrap the throw in a
    // promise.
    registerManagerOverrideHandler(() => {
      throw new Error('cancelled');
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'missing_capability', capability: 'can_void' }, { status: 403 }),
    );

    const { error } = await api.request('POST', '/orders/1/void', { body: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error?.capability).toBe('can_void');
  });

  it('never retries more than once, even if the replay ALSO comes back missing_capability (no infinite loop)', async () => {
    const handler = vi.fn().mockResolvedValue('one-shot-token');
    registerManagerOverrideHandler(handler);

    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'missing_capability', capability: 'can_void' }, { status: 403 }),
    );

    const { error } = await api.request('POST', '/orders/1/void', { body: {} });

    expect(handler).toHaveBeenCalledTimes(1); // not called again on the replay's own 403
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + exactly one replay
    expect(error?.capability).toBe('can_void');
  });

  it('an unregistered handler stops intercepting once unregistered', async () => {
    const handler = vi.fn().mockResolvedValue('one-shot-token');
    const unregister = registerManagerOverrideHandler(handler);
    unregister();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'missing_capability', capability: 'can_void' }, { status: 403 }),
    );

    await api.request('POST', '/orders/1/void', { body: {} });
    expect(handler).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// auth surface
// ---------------------------------------------------------------------------

describe('api.auth', () => {
  it('signInWithPassword persists the session and returns { user, session }', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'tok', refresh_token: 'rt', user: { id: 'u1' } }),
    );
    const { data, error } = await api.auth.signInWithPassword({ email: 'a@b.com', password: 'pw' });
    expect(error).toBeNull();
    expect(data?.user).toEqual({ id: 'u1' });
    expect(JSON.parse(localStorage.getItem('bb.auth')!).access_token).toBe('tok');
  });

  it('signInWithPassword does not persist anything on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid credentials' }, { status: 401 }));
    const { data, error } = await api.auth.signInWithPassword({ email: 'a@b.com', password: 'wrong' });
    expect(data).toBeNull();
    expect(error?.message).toBe('invalid credentials');
    expect(localStorage.getItem('bb.auth')).toBeNull();
  });

  it('signOut clears the stored session even though the endpoint call is fire-and-forget', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'tok', refresh_token: 'rt' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await api.auth.signOut();
    expect(localStorage.getItem('bb.auth')).toBeNull();
  });

  it('getSession returns null without a network call when nothing is stored', async () => {
    const { data } = await api.auth.getSession();
    expect(data.session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getSession returns the stored session without a network call', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'tok' }));
    const { data } = await api.auth.getSession();
    expect(data.session?.access_token).toBe('tok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('onAuthStateChange fires once with the current session shortly after subscribing', async () => {
    localStorage.setItem('bb.auth', JSON.stringify({ access_token: 'tok' }));
    const cb = vi.fn();
    api.auth.onAuthStateChange(cb);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cb).toHaveBeenCalledWith('INITIAL_SESSION', expect.objectContaining({ access_token: 'tok' }));
  });
});

// ---------------------------------------------------------------------------
// supabase.from() query builder
// ---------------------------------------------------------------------------

describe('supabase.from — filter/order/limit query-string construction', () => {
  it('builds eq / order / limit into the querystring', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await supabase.from('items').select('id,name').eq('category_id', '5').order('name', { ascending: false }).limit(10);

    const url = lastCallUrl();
    expect(url.pathname).toBe('/data/items');
    expect(url.searchParams.get('eq')).toBe('category_id,5');
    expect(url.searchParams.get('order')).toBe('name.desc');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('select')).toBe('id,name');
  });

  it('builds an `in` filter as a single comma-joined param', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await supabase.from('items').select().in('id', ['a', 'b', 'c']);
    const url = lastCallUrl();
    expect(url.searchParams.get('in')).toBe('id,a,b,c');
  });

  it('builds an `is` filter for null/true/false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await supabase.from('items').select().is('deleted_at', null);
    const url = lastCallUrl();
    expect(url.searchParams.get('is')).toBe('deleted_at,null');
  });

  it('omits the select param entirely for the default "*" selection', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await supabase.from('items').select();
    const url = lastCallUrl();
    expect(url.searchParams.has('select')).toBe(false);
  });
});

describe('supabase.from — insert / update / delete', () => {
  it('insert POSTs the row(s) as the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: '1' }]));
    const { data } = await supabase.from('items').insert({ name: 'Burger' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(new URL(url, 'http://x').pathname).toBe('/data/items');
    expect(JSON.parse(init.body)).toEqual({ name: 'Burger' });
    expect(data).toEqual([{ id: '1' }]);
  });

  it('insert().select().single() unwraps the first row from an array response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: '1', name: 'Burger' }]));
    const { data } = await supabase.from('items').insert({ name: 'Burger' }).select().single();
    expect(data).toEqual({ id: '1', name: 'Burger' });
  });

  it('update PATCHes the changes and includes the eq filter in the querystring', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: '1', name: 'New' }]));
    await supabase.from('items').update({ name: 'New' }).eq('id', '1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(new URL(url, 'http://x').searchParams.get('eq')).toBe('id,1');
    expect(JSON.parse(init.body)).toEqual({ name: 'New' });
  });

  it('delete issues a DELETE with the eq filter, no body', async () => {
    fetchMock.mockResolvedValueOnce(noContentResponse());
    await supabase.from('items').delete().eq('id', '1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(new URL(url, 'http://x').searchParams.get('eq')).toBe('id,1');
  });
});

describe('supabase.from — single() / maybeSingle()', () => {
  it('maybeSingle() returns { data: null, error: null } on a 404, instead of surfacing an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { status: 404 }));
    const { data, error } = await supabase.from('items').select().eq('id', 'missing').maybeSingle();
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('maybeSingle() unwraps a single-element array response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: '1' }]));
    const { data } = await supabase.from('items').select().eq('id', '1').maybeSingle();
    expect(data).toEqual({ id: '1' });
  });

  it('single() still surfaces a genuine (non-404) error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'server error' }, { status: 500 }));
    const { data, error } = await supabase.from('items').select().eq('id', '1').single();
    expect(data).toBeNull();
    expect(error?.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Embedded-join resolution (parseSelect / resolveEmbeds)
// ---------------------------------------------------------------------------

describe('supabase.from — embedded joins (the hand-rolled PostgREST-embed shim)', () => {
  it('resolves a "one" edge (orders → customers) and a "many" edge (orders → order_items) in one select', async () => {
    // Same fetchMock-typing gap as the coalescing test above — not a bug.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    fetchMock.mockImplementation((url) => {
      const u = new URL(url, 'http://x');
      if (u.pathname === '/data/orders') {
        return Promise.resolve(
          jsonResponse([
            { id: 'o1', customer_id: 'c1' },
            { id: 'o2', customer_id: 'c2' },
            { id: 'o3', customer_id: null },
          ]),
        );
      }
      if (u.pathname === '/data/customers') {
        expect(u.searchParams.get('in')).toBe('id,c1,c2');
        expect(u.searchParams.get('select')).toBe('id,name');
        return Promise.resolve(
          jsonResponse([
            { id: 'c1', name: 'Alice' },
            { id: 'c2', name: 'Bob' },
          ]),
        );
      }
      if (u.pathname === '/data/order_items') {
        expect(u.searchParams.get('in')).toBe('order_id,o1,o2,o3');
        return Promise.resolve(
          jsonResponse([
            { id: 'i1', order_id: 'o1', qty: 2 },
            { id: 'i2', order_id: 'o1', qty: 1 },
            { id: 'i3', order_id: 'o2', qty: 5 },
          ]),
        );
      }
      throw new Error(`unexpected fetch: ${u.pathname}`);
    });

    const { data, error } = await supabase
      .from('orders')
      .select('id, customers (id, name), order_items (id, qty)');

    expect(error).toBeNull();
    const rows = data as OrderRowWithEmbeds[];
    const o1 = rows.find((r) => r.id === 'o1')!;
    const o2 = rows.find((r) => r.id === 'o2')!;
    const o3 = rows.find((r) => r.id === 'o3')!;

    expect(o1.customers).toEqual({ id: 'c1', name: 'Alice' });
    expect(o2.customers).toEqual({ id: 'c2', name: 'Bob' });
    expect(o3.customers).toBeNull(); // no customer_id → no lookup, not a crash

    expect(o1.order_items).toEqual([
      { id: 'i1', order_id: 'o1', qty: 2 },
      { id: 'i2', order_id: 'o1', qty: 1 },
    ]);
    expect(o2.order_items).toEqual([{ id: 'i3', order_id: 'o2', qty: 5 }]);
    expect(o3.order_items).toEqual([]); // no child rows → empty array, not undefined
  });

  it('sets the joined field to null on every row when the relation has no FK mapping', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'o1' }]));
    const { data } = await supabase.from('orders').select('id, nonexistent_relation (id)');
    expect(data[0].nonexistent_relation).toBeNull();
    // Only the base fetch happened — no doomed follow-up request for an
    // unmapped relation.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does no follow-up fetch when the base query returns zero rows', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const { data } = await supabase.from('orders').select('id, customers (id, name)');
    expect(data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// rpc() and functions.invoke()
// ---------------------------------------------------------------------------

describe('api.rpc', () => {
  it('POSTs to /rpc/{fn} with the args as the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: 42 }));
    const { data } = await api.rpc('compute_total', { order_id: 'o1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url, 'http://x').pathname).toBe('/rpc/compute_total');
    expect(JSON.parse(init.body)).toEqual({ order_id: 'o1' });
    expect(data).toEqual({ result: 42 });
  });
});

describe('supabase.functions.invoke', () => {
  it('maps a known function name to its Go route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ sent: true }));
    await supabase.functions.invoke('chatbot-whatsapp-send', { body: { to: '+123' } });
    const [url] = fetchMock.mock.calls[0];
    expect(new URL(url, 'http://x').pathname).toBe('/chatbot/whatsapp/send');
  });

  it('returns an error for an unmapped function name, without calling fetch', async () => {
    const { data, error } = await supabase.functions.invoke('does-not-exist', { body: {} });
    expect(data).toBeNull();
    expect(error?.message).toContain('does-not-exist');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
