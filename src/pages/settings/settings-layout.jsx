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
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  {
    title: 'Business',
    items: [
      { label: 'Organization', to: '/settings/organization', icon: Building2 },
      { label: 'Locations', to: '/settings/organization?tab=locations', icon: MapPin },
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

function isItemActive(itemPath, currentPath) {
  const [base] = itemPath.split('?');
  if (currentPath === base) return true;
  // /settings/billing/wallet should highlight Billing
  return currentPath.startsWith(base + '/');
}

export default function SettingsLayout() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure your organization, billing, storefront, and system integrations.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="md:sticky md:top-20 md:self-start">
            <nav className="space-y-6 bg-white border border-gray-200 rounded-lg p-4">
              {SECTIONS.map((section) => (
                <div key={section.title}>
                  <h2 className="px-2 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {section.title}
                  </h2>
                  <ul className="space-y-1">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active = isItemActive(item.to, pathname);
                      return (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            className={cn(
                              'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                              active
                                ? 'bg-orange-50 text-orange-700 font-medium'
                                : 'text-gray-700 hover:bg-gray-50'
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
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
            <div className="bg-white border border-gray-200 rounded-lg">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
