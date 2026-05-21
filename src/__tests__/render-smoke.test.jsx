// render-smoke.test.jsx
//
// Vitest + React Testing Library render tests.
// Covers OnboardingChecklist (lightweight enough to render in jsdom).
// PosWorkspacePage is covered by pos-workspace-smoke.test.jsx which tests
// module initialisation (the layer where TDZ crashes actually happen) without
// loading the full render-heavy dependency graph (recharts, react-pdf, etc.).

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- Mocks ----

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
    }),
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

// OnboardingChecklist uses this sub-component — stub so we don't need its imports.
vi.mock('@/pages/home/components/add-location-modal', () => ({ default: () => null }));

// ---- Component under test ----
import OnboardingChecklist from '@/pages/home/components/onboarding-checklist';

function Wrapper({ children }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

// ---- Tests ----

describe('OnboardingChecklist — mount smoke', () => {
  it('renders without throwing', () => {
    expect(() =>
      render(
        <Wrapper>
          <OnboardingChecklist onComplete={vi.fn()} />
        </Wrapper>,
      ),
    ).not.toThrow();
  });

  it('shows "Setup progress" text', () => {
    render(
      <Wrapper>
        <OnboardingChecklist onComplete={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.getByText(/Setup progress/i)).toBeInTheDocument();
  });
});
