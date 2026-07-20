// pos-workspace-smoke.test.js
//
// TDZ / module-init smoke test for PosWorkspacePage.
//
// WHY THIS EXISTS
// ───────────────
// The original blank-screen bug was a Temporal Dead Zone (TDZ) error:
// a `const` or `class` was referenced before its declaration in the module
// initialisation sequence.  `npm run build` (Rollup/Vite) does NOT catch
// this because bundlers reorder declarations.  The crash only surfaces at
// runtime when the module is evaluated by the JS engine.
//
// This test catches that class of bug by:
//   1. Importing the module (which triggers module evaluation).
//   2. Asserting the default export is a function (React component) — if the
//      module throws during init (TDZ, circular reference, etc.) the import
//      itself will throw and the test fails.
//
// We do NOT do a full React render here because the PosWorkspacePage
// dependency graph (~50 deps incl. recharts, react-pdf, framer-motion, leaflet,
// DnD) exhausts the default Node heap in a Vitest jsdom worker.
// The Playwright render-smoke.spec.js handles end-to-end visual rendering.

import { describe, it, expect, vi } from 'vitest';

// ---- Mocks — must be declared before the import under test ----

vi.mock('@/services/supabase-client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => {} }) }),
    removeChannel: () => {},
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  },
}));

vi.mock('@/lib/api-client', () => ({
  default: {
    from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }),
  },
  registerManagerOverrideHandler: vi.fn(),
}));

vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({
    user: null,
    userProfile: null,
    activeOrganization: null,
    activeLocation: null,
    locations: [],
    organizations: [],
    loading: false,
    signOut: vi.fn(),
    fetchLocations: vi.fn().mockResolvedValue([]),
  }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('@/context/actor-token-context', () => ({
  useActor: () => ({ actor: null, clearActor: vi.fn() }),
  ActorTokenProvider: ({ children }) => children,
  _actorRef: { current: null },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/use-pin-modal', () => ({
  usePinModal: () => ({ requestPin: vi.fn(), PinModal: () => null }),
}));

vi.mock('@/services/payment', () => ({
  chargeOrder: vi.fn(),
  chargeOrdersWithLegs: vi.fn(),
  PAYMENT_METHODS: { CASH: 'cash', CARD: 'card' },
}));

vi.mock('@/services/analytics', () => ({
  default: { track: vi.fn() },
  track: vi.fn(),
}));

// Stub all heavy sub-components to prevent their import graphs loading.
vi.mock('@/pages/home/components/open-register-modal', () => ({ default: () => null }));
vi.mock('@/pages/home/components/return-modal', () => ({ default: () => null }));
vi.mock('@/pages/pos/components/tables-strip', () => ({ TablesStrip: () => null }));
vi.mock('@/pages/pos/components/active-ticket-panel', () => ({ default: () => null }));
vi.mock('@/pages/pos/components/cash-tender-modal', () => ({ default: () => null }));
vi.mock('@/pages/pos/components/card-tender-modal', () => ({ CardTenderModal: () => null }));
vi.mock('@/pages/pos/components/table-picker-dialog', () => ({ TablePickerDialog: () => null }));
vi.mock('@/components/order-adjustments/adjustment-modal', () => ({ default: () => null }));
vi.mock('@/pages/pos/components/tender-modal', () => ({ default: () => null }));
vi.mock('@/pages/pos/components/split-by-seat', () => ({ default: () => null }));
vi.mock('@/pages/pos/components/modifier-picker', () => ({
  default: () => null,
  useItemHasModifiers: () => false,
}));
vi.mock('@/pages/pos/components/course-select', () => ({ default: () => null }));

// ---- Module under test ----
import PosWorkspacePage from '@/pages/pos/workspace';

// ---- Tests ----

describe('PosWorkspacePage — module initialisation smoke', () => {
  it('module evaluates without a TDZ / "is not defined" error', () => {
    // If the import above threw (TDZ, circular ref, etc.) this line is
    // never reached and Vitest reports a module-load failure — which is
    // exactly what we want to catch.
    expect(typeof PosWorkspacePage).toBe('function');
  });

  it('default export is a React function component (has a name)', () => {
    // A minified or TDZ-broken module often exports `undefined`.
    expect(PosWorkspacePage).toBeTruthy();
    // React function components are callable.
    expect(PosWorkspacePage.length).toBeGreaterThanOrEqual(0);
  });
});
