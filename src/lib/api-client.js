// api-client.js — a thin fetch wrapper that mimics the subset of supabase-js
// the app uses (.from().select()/.insert()/.update()/.delete(), .rpc(), and
// .auth.* for sign-in flows). It hits the Go backend at VITE_API_URL.
//
// Tokens are persisted to localStorage. The client auto-refreshes once on a
// 401 and replays the original request.
//
// Actor token: when a staff PIN overlay is active the ActorTokenProvider keeps
// an in-memory reference (_actorRef). Authenticated requests automatically
// include X-Actor-Token if that ref holds a non-expired token. The import is
// lazy (dynamic) to avoid a circular-module issue — the context file imports
// nothing from here, but we still defer the read to call-time.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

const STORAGE_KEY = 'bb.auth';

// Singleton ref populated by ActorTokenProvider (actor-token-context.jsx).
// Resolved once via a side-effect import so the reference is available
// synchronously on every subsequent request. Safe to call before the import
// settles — the header is simply omitted on the very first request in that
// race (essentially impossible in practice since the Provider mounts before
// any authenticated request fires).
// Shape when set: { _token: string, _expiresAt: number, ... }
let _actorRefSync = null;
import('@/context/actor-token-context')
  .then((mod) => { _actorRefSync = mod._actorRef; })
  .catch(() => { _actorRefSync = { current: null }; });

// ---- token storage ----

function readAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeAuth(v) {
  if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  else localStorage.removeItem(STORAGE_KEY);
}

let listeners = new Set();
function emitAuth(event, session) {
  for (const cb of listeners) {
    try { cb(event, session); } catch (e) { console.error(e); }
  }
}

// ---- global missing_capability subscriber ----------------------------------
// Components subscribe once (e.g. in a root layout useEffect) to receive a
// toast whenever the server returns 403 { error:"missing_capability", capability:"can_xxx" }.
let capabilityListeners = new Set();
export function onMissingCapability(cb) {
  capabilityListeners.add(cb);
  return () => capabilityListeners.delete(cb);
}
function emitMissingCapability(capability) {
  for (const cb of capabilityListeners) {
    try { cb(capability); } catch (e) { console.error(e); }
  }
}

// ---- manager-override handler ----------------------------------------------
// Register exactly ONE async handler that receives { capability, reason } and
// returns a one-shot manager token string (or throws/returns null to abort).
// The api-client's request() will retry the original call with that token
// attached as X-Actor-Token for ONE request only — the actor session is NOT
// switched globally.
//
// Usage: registerManagerOverrideHandler(async ({ capability }) => {
//   const token = await requestPin({ reason: capability, isManagerOverride: true });
//   return token;
// });
let _managerOverrideHandler = null;
export function registerManagerOverrideHandler(fn) {
  _managerOverrideHandler = fn;
  return () => { if (_managerOverrideHandler === fn) _managerOverrideHandler = null; };
}

// ---- low-level fetch ----

async function raw(method, path, { body, headers = {}, auth = true } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (auth) {
    const a = readAuth();
    if (a?.access_token) h.Authorization = `Bearer ${a.access_token}`;

    // Attach actor token from the in-memory singleton if available and valid.
    const actorRef = _actorRefSync;
    if (actorRef?.current?._token && actorRef.current._expiresAt > Date.now()) {
      h['X-Actor-Token'] = actorRef.current._token;
    }
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });
  return res;
}

let refreshing = null;

async function refreshIfNeeded() {
  const a = readAuth();
  if (!a?.refresh_token) return false;
  if (!refreshing) {
    refreshing = (async () => {
      const res = await raw('POST', '/auth/refresh', { body: { refresh_token: a.refresh_token }, auth: false });
      if (!res.ok) {
        writeAuth(null);
        emitAuth('SIGNED_OUT', null);
        return false;
      }
      const session = await res.json();
      writeAuth(session);
      emitAuth('TOKEN_REFRESHED', session);
      return true;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function request(method, path, opts = {}) {
  let res = await raw(method, path, opts);
  if (res.status === 401 && opts.auth !== false) {
    const ok = await refreshIfNeeded();
    if (ok) res = await raw(method, path, opts);
  }
  if (res.status === 204) return { data: null, error: null };
  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!res.ok) {
    const msg = (payload && payload.error) || res.statusText || 'request failed';

    // Manager-override path: on 403 missing_capability, if a handler is
    // registered, ask for a manager PIN and replay the request ONCE with
    // the one-shot token attached. The actor session is NOT changed globally.
    if (
      res.status === 403 &&
      payload &&
      payload.error === 'missing_capability' &&
      payload.capability &&
      _managerOverrideHandler &&
      !opts._managerOverrideAttempted // prevent infinite retry
    ) {
      try {
        const oneShotToken = await _managerOverrideHandler({
          capability: payload.capability,
          reason: payload.capability.replace(/_/g, ' '),
        });
        if (oneShotToken) {
          // Replay the request with the override token injected.
          const overrideOpts = {
            ...opts,
            _managerOverrideAttempted: true,
            headers: {
              ...(opts.headers || {}),
              'X-Actor-Token': oneShotToken,
            },
          };
          return request(method, path, overrideOpts);
        }
      } catch {
        // Handler threw (user cancelled) — fall through to normal error.
      }
    }

    // Fire global missing_capability subscribers so any subscribed toast handler
    // can notify the user without per-call boilerplate.
    if (res.status === 403 && payload && payload.error === 'missing_capability' && payload.capability) {
      emitMissingCapability(payload.capability);
    }
    return { data: null, error: { message: msg, status: res.status, capability: payload?.capability } };
  }
  return { data: payload, error: null };
}

// ---- auth surface (matches supabase.auth.*) ----

const auth = {
  async signUp({ email, password, options }) {
    const { data, error } = await request('POST', '/auth/signup', {
      auth: false,
      body: { email, password, meta: options?.data },
    });
    if (error) return { data: null, error };
    writeAuth(data);
    emitAuth('SIGNED_IN', data);
    return { data: { user: data.user, session: data }, error: null };
  },

  async signInWithPassword({ email, password }) {
    const { data, error } = await request('POST', '/auth/signin', {
      auth: false,
      body: { email, password },
    });
    if (error) return { data: null, error };
    writeAuth(data);
    emitAuth('SIGNED_IN', data);
    return { data: { user: data.user, session: data }, error: null };
  },

  async signOut() {
    const a = readAuth();
    await request('POST', '/auth/signout', { body: { refresh_token: a?.refresh_token }, auth: false });
    writeAuth(null);
    emitAuth('SIGNED_OUT', null);
    return { error: null };
  },

  async getSession() {
    const a = readAuth();
    if (!a) return { data: { session: null }, error: null };
    return { data: { session: a }, error: null };
  },

  async getUser() {
    const a = readAuth();
    if (!a) return { data: { user: null }, error: null };
    const { data, error } = await request('GET', '/auth/me');
    if (error) return { data: { user: null }, error };
    return { data: { user: data }, error: null };
  },

  async refreshSession() {
    const ok = await refreshIfNeeded();
    if (!ok) return { data: { session: null }, error: { message: 'refresh failed' } };
    return { data: { session: readAuth() }, error: null };
  },

  async updateUser(/* updates */) {
    // TODO(backend): no self-service "change own password while authenticated"
    // endpoint exists yet. The email password-reset flow (POST /auth/password/forgot
    // → token email → POST /auth/password/reset) is the supported path.
    // When a /auth/me/password endpoint lands, wire it here.
    return {
      data: null,
      error: {
        message:
          'To change your password, use the "Forgot password" link on the sign-in page. A reset link will be emailed to you.',
      },
    };
  },

  async resetPasswordForEmail(email /* , opts */) {
    // POST /auth/password/forgot always returns 200 — backend never reveals
    // whether the address exists. Mirrors the Supabase surface so call-sites
    // don't need changes.
    const { data, error } = await request('POST', '/auth/password/forgot', {
      auth: false,
      body: { email },
    });
    if (error) return { data: null, error };
    return { data, error: null };
  },

  onAuthStateChange(cb) {
    listeners.add(cb);
    // fire once with current state to match supabase's behavior.
    setTimeout(() => cb('INITIAL_SESSION', readAuth()), 0);
    return {
      data: {
        subscription: {
          unsubscribe: () => listeners.delete(cb),
        },
      },
    };
  },
};

// ---- embedded-join support ----
//
// supabase-js lets callers do `.select('*, customers (id, name), order_items (*)')`
// to pull in related rows in one call. Our Go data layer doesn't parse that
// syntax, so the client peels off joined relations, fetches the parent rows
// with scalar columns, then does a follow-up IN query per joined table.
//
// Relationships are described here. A 'many' edge means the child table has
// an FK back to the parent; we filter the child by that FK IN (parent ids).
// A 'one' edge means the parent row carries the FK directly; we collect
// those FK values and do IN on the child's primary key.

const FK = {
  // parent -> { childRelationName: { table, kind: 'one'|'many', col } }
  //   kind 'one':  parent[col] points at child.id
  //   kind 'many': child[col] points at parent.id
  orders: {
    customers:      { table: 'customers',              kind: 'one',  col: 'customer_id' },
    order_items:    { table: 'order_items',            kind: 'many', col: 'order_id' },
  },
  order_items: {
    items:                 { table: 'items',                 kind: 'one',  col: 'item_id' },
    order_item_variations: { table: 'order_item_variations', kind: 'many', col: 'order_item_id' },
  },
  order_item_variations: {
    item_variations:        { table: 'item_variations',        kind: 'one', col: 'variation_id' },
    item_variation_options: { table: 'item_variation_options', kind: 'one', col: 'option_id' },
  },
  items: {
    categories:      { table: 'categories',      kind: 'one',  col: 'category_id' },
    item_variations: { table: 'item_variations', kind: 'many', col: 'item_id' },
  },
  item_variations: {
    item_variation_options: { table: 'item_variation_options', kind: 'many', col: 'variation_id' },
  },
  item_recipes: {
    items: { table: 'items', kind: 'one', col: 'child_item_id' },
  },
  organization_members: {
    profiles: { table: 'profiles', kind: 'one', col: 'profile_id' },
  },
  organization_invites: {
    profiles: { table: 'profiles', kind: 'one', col: 'invited_by' },
  },
  locations: {
    organizations: { table: 'organizations', kind: 'one', col: 'organization_id' },
  },
  staff: {
    locations: { table: 'locations', kind: 'one', col: 'location_id' },
  },
};

// parseSelect("*, customers (id, name), order_items (*)") →
//   { base: '*', joins: [ {name:'customers', cols:'id,name'}, {name:'order_items', cols:'*'} ] }
// Whitespace tolerant. Doesn't handle deeper than one level; nested parens
// inside a join become that join's scalar cols. Good enough for current usage.
function parseSelect(raw) {
  if (!raw || !/\(/.test(raw)) return { base: raw || '*', joins: [] };
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const joins = [];
  const base = [];
  let i = 0;
  while (i < normalized.length) {
    // skip leading whitespace + commas
    while (i < normalized.length && /[\s,]/.test(normalized[i])) i++;
    if (i >= normalized.length) break;
    // read identifier up to ',' or '('
    let j = i;
    while (j < normalized.length && !/[,()]/.test(normalized[j])) j++;
    const token = normalized.slice(i, j).trim();
    if (normalized[j] === '(') {
      // embedded join
      let depth = 1;
      let k = j + 1;
      while (k < normalized.length && depth > 0) {
        if (normalized[k] === '(') depth++;
        else if (normalized[k] === ')') depth--;
        if (depth === 0) break;
        k++;
      }
      const cols = normalized.slice(j + 1, k).replace(/\s+/g, '').replace(/,+$/, '');
      if (token) joins.push({ name: token, cols: cols || '*' });
      i = k + 1;
    } else {
      if (token) base.push(token);
      i = j;
    }
  }
  return { base: base.length ? base.join(',') : '*', joins };
}

async function resolveEmbeds(parentTable, rows, joins) {
  if (!joins.length || !rows.length) return rows;
  const map = FK[parentTable] || {};
  for (const j of joins) {
    const edge = map[j.name];
    if (!edge) {
      for (const r of rows) r[j.name] = null;
      continue;
    }
    if (edge.kind === 'one') {
      const ids = [...new Set(rows.map(r => r[edge.col]).filter(v => v != null))];
      if (!ids.length) { for (const r of rows) r[j.name] = null; continue; }
      const qs = new URLSearchParams();
      qs.append('in', ['id', ...ids].join(','));
      if (j.cols && j.cols !== '*') qs.set('select', j.cols);
      const res = await request('GET', `/data/${edge.table}?${qs.toString()}`);
      const byId = new Map((res.data || []).map(r => [r.id, r]));
      for (const r of rows) r[j.name] = byId.get(r[edge.col]) || null;
    } else {
      const ids = [...new Set(rows.map(r => r.id).filter(v => v != null))];
      if (!ids.length) { for (const r of rows) r[j.name] = []; continue; }
      const qs = new URLSearchParams();
      qs.append('in', [edge.col, ...ids].join(','));
      if (j.cols && j.cols !== '*') qs.set('select', j.cols);
      const res = await request('GET', `/data/${edge.table}?${qs.toString()}`);
      const grouped = new Map();
      for (const child of res.data || []) {
        const k = child[edge.col];
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k).push(child);
      }
      for (const r of rows) r[j.name] = grouped.get(r.id) || [];
    }
  }
  return rows;
}

// ---- query builder (matches supabase.from(...)) ----
//
// Supported:
//   .select(cols?).eq(col,val).neq/.gt/.gte/.lt/.lte/.like/.ilike/.in(col,[…])
//   .is(col, null|true|false)
//   .order(col, { ascending })
//   .limit(n)
//   .single() / .maybeSingle()
//   .insert(row|rows[]).select()
//   .update(changes).eq(...).select()
//   .delete().eq(...)
//   .upsert(row|rows[]) — (mapped to insert for now; add when needed)

class Builder {
  constructor(table) {
    this._table = table;
    this._mode = 'select';
    this._cols = '*';
    this._filters = []; // {op, col, val}
    this._orders = [];  // {col, asc}
    this._limit = null;
    this._body = null;
    this._returning = false;
    this._single = false;
    this._maybeSingle = false;
  }

  select(cols) {
    this._cols = cols || '*';
    if (this._mode === 'insert' || this._mode === 'update') {
      // keep current mode; mark that we want the rows back.
      this._returning = true;
    } else {
      this._mode = 'select';
    }
    return this;
  }

  insert(rows) {
    this._mode = 'insert';
    this._body = rows;
    return this;
  }
  upsert(rows) {
    // Fallback: behave like insert. Extend when unique-conflict needed.
    this._mode = 'insert';
    this._body = rows;
    return this;
  }
  update(changes) {
    this._mode = 'update';
    this._body = changes;
    return this;
  }
  delete() {
    this._mode = 'delete';
    return this;
  }

  // -- filters --
  eq(col, v)    { this._filters.push({ op: 'eq', col, val: v }); return this; }
  neq(col, v)   { this._filters.push({ op: 'neq', col, val: v }); return this; }
  gt(col, v)    { this._filters.push({ op: 'gt', col, val: v }); return this; }
  gte(col, v)   { this._filters.push({ op: 'gte', col, val: v }); return this; }
  lt(col, v)    { this._filters.push({ op: 'lt', col, val: v }); return this; }
  lte(col, v)   { this._filters.push({ op: 'lte', col, val: v }); return this; }
  like(col, v)  { this._filters.push({ op: 'like', col, val: v }); return this; }
  ilike(col, v) { this._filters.push({ op: 'ilike', col, val: v }); return this; }
  in(col, arr)  { this._filters.push({ op: 'in', col, val: arr }); return this; }
  is(col, v) {
    let s;
    if (v === null) s = 'null';
    else if (v === true) s = 'true';
    else if (v === false) s = 'false';
    else s = String(v);
    this._filters.push({ op: 'is', col, val: s });
    return this;
  }

  order(col, { ascending = true } = {}) {
    this._orders.push({ col, asc: ascending });
    return this;
  }
  limit(n) { this._limit = n; return this; }

  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }

  _qs(extra = {}) {
    const params = new URLSearchParams();
    for (const f of this._filters) {
      if (f.op === 'in') {
        params.append('in', [f.col, ...f.val].join(','));
      } else if (f.op === 'is') {
        params.append('is', `${f.col},${f.val}`);
      } else {
        params.append(f.op, `${f.col},${serialize(f.val)}`);
      }
    }
    for (const o of this._orders) {
      params.append('order', `${o.col}.${o.asc ? 'asc' : 'desc'}`);
    }
    if (this._limit != null) params.set('limit', String(this._limit));
    if (extra.baseCols && extra.baseCols !== '*' && this._mode === 'select') {
      params.set('select', extra.baseCols);
    }
    if (extra.single) params.set('single', 'true');
    const s = params.toString();
    return s ? `?${s}` : '';
  }

  async _run() {
    const path = `/data/${encodeURIComponent(this._table)}`;
    switch (this._mode) {
      case 'select': {
        const parsed = parseSelect(this._cols);
        // Force multi-row fetch so we can resolve embeds, then unwrap to single.
        const wantSingle = this._single;
        const qs = this._qs({ baseCols: parsed.base, single: wantSingle && !parsed.joins.length });
        const res = await request('GET', `${path}${qs}`);
        let { data, error } = res;
        if (error) {
          if (this._maybeSingle && error.status === 404) return { data: null, error: null };
          return { data: null, error };
        }
        if (parsed.joins.length) {
          const rows = Array.isArray(data) ? data : (data ? [data] : []);
          await resolveEmbeds(this._table, rows, parsed.joins);
          if (wantSingle) return { data: rows[0] || null, error: null };
          if (this._maybeSingle) return { data: rows[0] || null, error: null };
          return { data: rows, error: null };
        }
        if (this._maybeSingle) {
          if (Array.isArray(data)) return { data: data[0] || null, error: null };
          return { data, error: null };
        }
        return { data, error: null };
      }
      case 'insert': {
        const { data, error } = await request('POST', path, { body: this._body });
        if (error) return { data, error };
        if (this._single) return { data: Array.isArray(data) ? data[0] : data, error: null };
        return { data, error: null };
      }
      case 'update': {
        const qs = this._qs();
        const { data, error } = await request('PATCH', `${path}${qs}`, { body: this._body });
        if (error) return { data, error };
        if (this._single) return { data: Array.isArray(data) ? data[0] : data, error: null };
        return { data, error: null };
      }
      case 'delete': {
        const qs = this._qs();
        return request('DELETE', `${path}${qs}`);
      }
    }
  }

  then(onF, onR) { return this._run().then(onF, onR); }
  catch(onR)     { return this._run().catch(onR); }
  finally(onF)   { return this._run().finally(onF); }
}

function serialize(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function from(table) { return new Builder(table); }

async function rpc(fn, args = {}) {
  return request('POST', `/rpc/${encodeURIComponent(fn)}`, { body: args });
}

// ---- edge-function-style invoke (matches supabase.functions.invoke) ----

async function invokeFunction(name, { body } = {}) {
  // Map supabase function names → our Go endpoints.
  const route = {
    'chatbot-whatsapp-send': '/chatbot/whatsapp/send',
  }[name];
  if (!route) return { data: null, error: { message: `unknown function ${name}` } };
  return request('POST', route, { body });
}

// ---- exported client ----

export const supabase = {
  from,
  rpc,
  auth,
  functions: { invoke: invokeFunction },
};

// Raw helpers for code that wants to hit the REST layer directly.
export const api = { request, auth, from, rpc };

// Backwards-compat default export so `import supabase from ...` keeps working.
export default supabase;
