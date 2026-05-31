import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Building2,
  MapPin,
  CreditCard,
  Banknote,
  Tag,
  Globe,
  Truck,
  Heart,
  Key,
  Printer,
  ChefHat,
  UserCircle,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  {
    title: 'Business',
    items: [
      { label: 'Organization', to: '/settings/organization', icon: Building2 },
      {
        label: 'Locations',
        to: '/settings/organization?tab=locations',
        icon: MapPin,
        // Drill-down pages for a specific location (e.g. payments, settings)
        // are owned by this entry — they're navigated into FROM Locations.
        matchPaths: ['/settings/location/'],
      },
      { label: 'Domains', to: '/settings/domains', icon: Globe },
    ],
  },
  {
    title: 'Money',
    items: [
      { label: 'Billing', to: '/settings/billing', icon: CreditCard },
      { label: 'Payouts', to: '/settings/payouts', icon: Banknote },
    ],
  },
  {
    title: 'Storefront',
    items: [
      { label: 'Promotions', to: '/settings/promotions', icon: Tag },
      { label: 'Delivery zones', to: '/settings/delivery-zones', icon: Truck },
      { label: 'Loyalty', to: '/settings/loyalty', icon: Heart },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'API keys', to: '/settings/api-keys', icon: Key },
      { label: 'Hardware', to: '/settings/hardware', icon: Printer },
      { label: 'Kitchen routing', to: '/settings/kitchen', icon: ChefHat },
    ],
  },
  {
    title: 'You',
    items: [
      { label: 'Account', to: '/account', icon: UserCircle },
    ],
  },
];

function isItemActive(item, currentPath, currentSearch) {
  // Any additional path prefixes the item explicitly claims own it (drill-downs).
  if (item.matchPaths?.some((p) => currentPath === p.replace(/\/$/, '') || currentPath.startsWith(p))) {
    return true;
  }
  const [base, query] = item.to.split('?');
  // Items that target a specific tab (?tab=...) must match BOTH the path
  // and the tab — otherwise multiple items sharing a base would all light up.
  if (query) {
    const params = new URLSearchParams(query);
    const current = new URLSearchParams(currentSearch);
    if (currentPath !== base) return false;
    for (const [k, v] of params) {
      if (current.get(k) !== v) return false;
    }
    return true;
  }
  // For plain-path items, hide when a more specific sibling owns the URL.
  // Example: Organization shouldn't light up on /settings/organization?tab=locations.
  if (currentPath === base) {
    return !currentSearch || !new URLSearchParams(currentSearch).get('tab');
  }
  // /settings/billing/wallet should still highlight Billing.
  return currentPath.startsWith(base + '/');
}

export default function SettingsLayout() {
  const { pathname, search } = useLocation();

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Page header */}
        <header className="mb-6 sm:mb-8 flex items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Settings2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
              Settings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-[0.95rem]">
              Configure your organization, billing, storefront, and system integrations.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[240px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="md:sticky md:top-20 md:self-start">
            <nav
              className="rounded-2xl border border-border/60 bg-card shadow-card p-3 space-y-1"
              aria-label="Settings navigation"
            >
              {SECTIONS.map((section, sIdx) => (
                <div key={section.title} className={cn(sIdx > 0 && 'pt-3')}>
                  {/* Section divider line (except first) */}
                  {sIdx > 0 && (
                    <div className="mb-3 h-px bg-border/50 mx-1" />
                  )}
                  <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                    {section.title}
                  </p>
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active = isItemActive(item, pathname, search);
                      return (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'group flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-150',
                              active
                                ? 'bg-primary/10 text-primary font-semibold'
                                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
                                active
                                  ? 'bg-primary/15 text-primary'
                                  : 'text-muted-foreground/70 group-hover:text-foreground'
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate">{item.label}</span>
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
