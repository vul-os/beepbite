/**
 * StoreContext — host-based store resolution for the storefront / public pages.
 *
 * Reads window.location.hostname and determines whether the current page is
 * being served from:
 *
 *   (a) A slug-based subdomain:  <slug>.beepbite.io
 *       → exposes { storeSlug: slug, isStoreHost: true }
 *
 *   (b) A custom domain:         order.mybakery.com (anything not ending in
 *       .beepbite.io and not a reserved platform hostname)
 *       → exposes { storeSlug: null, customHostname: hostname, isStoreHost: true }
 *
 *   (c) The main platform host:  beepbite.io / app.beepbite.io / localhost / …
 *       → exposes { storeSlug: null, customHostname: null, isStoreHost: false }
 *
 * The orchestrator (e.g. main.jsx or a root layout) mounts StoreProvider near
 * the top of the tree so storefront pages can call useStore() without prop
 * drilling.
 *
 * Usage:
 *
 *   // In a root layout or main.jsx:
 *   import { StoreProvider } from '@/context/StoreContext';
 *   <StoreProvider><App /></StoreProvider>
 *
 *   // In a storefront component:
 *   import { useStore } from '@/context/StoreContext';
 *   const { storeSlug, customHostname, isStoreHost } = useStore();
 */

import React, { createContext, useContext, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEEPBITE_APEX = 'beepbite.io';

/** Platform-reserved subdomains that should NOT be treated as store hosts. */
const RESERVED_SUBDOMAINS = new Set(['app', 'api', 'www', 'admin']);

// ---------------------------------------------------------------------------
// Resolution logic (pure — no side effects, easy to test)
// ---------------------------------------------------------------------------

/**
 * Resolves the current hostname into store context.
 *
 * @param {string} hostname  e.g. "bakery.beepbite.io", "order.mybakery.com"
 * @returns {{ storeSlug: string|null, customHostname: string|null, isStoreHost: boolean }}
 */
export function resolveHostname(hostname) {
  if (!hostname) {
    return { storeSlug: null, customHostname: null, isStoreHost: false };
  }

  const host = hostname.toLowerCase().split(':')[0]; // strip port

  // Main apex — not a store host.
  if (host === BEEPBITE_APEX) {
    return { storeSlug: null, customHostname: null, isStoreHost: false };
  }

  // Subdomain of beepbite.io?
  if (host.endsWith(`.${BEEPBITE_APEX}`)) {
    const sub = host.slice(0, host.length - `.${BEEPBITE_APEX}`.length);

    // Reserved platform subdomains are not store hosts.
    if (RESERVED_SUBDOMAINS.has(sub)) {
      return { storeSlug: null, customHostname: null, isStoreHost: false };
    }

    // Treat the subdomain as a store slug.
    return { storeSlug: sub, customHostname: null, isStoreHost: true };
  }

  // localhost / 127.x / raw IP — development, not a store host.
  if (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('192.168.') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    return { storeSlug: null, customHostname: null, isStoreHost: false };
  }

  // Anything else is treated as a custom domain.
  return { storeSlug: null, customHostname: host, isStoreHost: true };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} StoreContextValue
 * @property {string|null} storeSlug       — slug portion of <slug>.beepbite.io, or null
 * @property {string|null} customHostname  — custom domain hostname, or null
 * @property {boolean}     isStoreHost     — true when the current host is a store host
 * @property {string}      hostname        — the raw (lowercased, port-stripped) hostname
 */

const StoreContext = createContext(/** @type {StoreContextValue} */ ({
  storeSlug: null,
  customHostname: null,
  isStoreHost: false,
  hostname: '',
}));

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * StoreProvider resolves the current hostname once on mount and makes the
 * result available to all children via useStore().
 *
 * @param {{ children: React.ReactNode, _hostname?: string }} props
 *   _hostname is an optional override for testing; omit in production.
 */
export function StoreProvider({ children, _hostname }) {
  const hostname = _hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');

  const value = useMemo(() => {
    const resolved = resolveHostname(hostname);
    return { ...resolved, hostname };
  }, [hostname]);

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useStore returns the resolved store context for the current hostname.
 * Must be used inside a StoreProvider.
 *
 * @returns {StoreContextValue}
 */
export function useStore() {
  return useContext(StoreContext);
}

export default StoreContext;
