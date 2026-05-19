// /manager — manager overview dashboard.
// Shows active promotions, today's menu schedule, 86'd items,
// allergen / dietary coverage stats, and recent audit log entries.

import React from 'react';
import { LayoutDashboard, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { useDashboard } from './hooks/use-dashboard';
import PromotionsCard from './components/promotions-card';
import ScheduleCard from './components/schedule-card';
import EightySixCard from './components/eighty-six-card';
import CoverageCard from './components/coverage-card';
import AuditLogCard from './components/audit-log-card';

export default function ManagerDashboard() {
  const { activeLocation, activeOrganization } = useAuth();

  const { data, loading, error, refetch } = useDashboard(
    activeLocation?.id,
    activeOrganization?.id,
  );

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
        <p className="font-medium text-foreground">No location selected</p>
        <p className="text-sm">Select a location to view the manager dashboard.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b bg-background flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-orange-500" />
            Manager Overview
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeLocation.name} — {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Dashboard grid */}
      <div className="flex-1 p-6 space-y-6">
        {/* Top 4 cards: 2-column on md+, 1-column on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PromotionsCard
            promotions={data.promotions}
            loading={loading}
          />
          <ScheduleCard
            schedules={data.schedules}
            loading={loading}
          />
          <EightySixCard
            items={data.eightySixedItems}
            loading={loading}
          />
          <CoverageCard
            allItems={data.allItems}
            itemAllergens={data.itemAllergens}
            itemDietaryTags={data.itemDietaryTags}
            loading={loading}
          />
        </div>

        {/* Full-width audit log */}
        <div className="grid grid-cols-1">
          <AuditLogCard
            entries={data.auditLog}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
