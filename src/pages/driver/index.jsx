import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Truck, AlertCircle, MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';

import {
  fetchAssignments,
  transitionAssignment,
  setShiftStatus,
} from '@/services/driver';

import AssignmentCard from './components/assignment-card';
import ShiftToggle from './components/shift-toggle';
import NotDriverCard from './components/not-driver-card';
import { useLocationPing } from './hooks/use-location-ping';

// Statuses that count as "active" for the ping gate
const ACTIVE_STATUSES = new Set(['accepted', 'picked_up']);

export default function DriverPortal() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Shift state ──────────────────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);

  // ── Assignments state ─────────────────────────────────────────────────────
  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState(null);
  // true when the user is confirmed not to be a driver anywhere (403 or empty
  // response that we treat as "no driver role")
  const [isNotDriver, setIsNotDriver] = useState(false);

  // ── Geo error banner ──────────────────────────────────────────────────────
  const [geoError, setGeoError] = useState(null);

  // ── Ping gate ─────────────────────────────────────────────────────────────
  // Find the active assignment (accepted or picked_up) to attach its ID to pings
  const activeAssignment = useMemo(
    () => assignments.find((a) => ACTIVE_STATUSES.has(a.status)),
    [assignments],
  );
  const pingActive = isOnline && !!activeAssignment;

  useLocationPing(pingActive, activeAssignment?.id, {
    onGeoError: (msg) => setGeoError(msg),
  });

  // ── Load assignments ───────────────────────────────────────────────────────
  const loadAssignments = useCallback(async () => {
    setLoadingAssignments(true);
    setAssignmentsError(null);
    setIsNotDriver(false);
    try {
      const data = await fetchAssignments();
      setAssignments(data);
      if (data.length === 0) {
        // Empty array = no current deliveries — not the same as "not a driver";
        // we optimistically treat empty as "driver, just no work right now".
        // A 403 is caught below.
      }
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        // Backend signals this user has no driver role anywhere.
        setIsNotDriver(true);
      } else {
        setAssignmentsError(err.message || 'Failed to load assignments');
      }
    } finally {
      setLoadingAssignments(false);
    }
  }, []);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  // ── Handle shift toggle ───────────────────────────────────────────────────
  async function handleShiftToggle(newValue) {
    setShiftLoading(true);
    const targetStatus = newValue ? 'online' : 'offline';
    try {
      await setShiftStatus(targetStatus);
      setIsOnline(newValue);
      if (!newValue) setGeoError(null); // clear geo banner when going offline
    } catch (err) {
      toast({
        title: `Could not go ${targetStatus}`,
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setShiftLoading(false);
    }
  }

  // ── Handle assignment actions ─────────────────────────────────────────────
  async function handleAction(id, action) {
    try {
      await transitionAssignment(id, action);
      // Optimistically update the status in local state so the card re-renders
      // immediately; a background refresh will reconcile.
      setAssignments((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const nextStatus = {
            accept: 'accepted',
            pickup: 'picked_up',
            deliver: 'delivered',
            cancel: 'cancelled',
          }[action];
          return nextStatus ? { ...a, status: nextStatus } : a;
        }),
      );
      // Remove terminal statuses (delivered / cancelled) after a short delay
      // so the driver can see the confirmation before it disappears.
      if (action === 'deliver' || action === 'cancel') {
        setTimeout(() => {
          setAssignments((prev) =>
            prev.filter((a) => a.id !== id || (a.status !== 'delivered' && a.status !== 'cancelled')),
          );
        }, 2500);
      }
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err.message,
        variant: 'destructive',
      });
      // Re-fetch to make sure local state is consistent with server.
      loadAssignments();
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function renderAssignmentsList() {
    if (loadingAssignments) {
      return (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      );
    }

    if (isNotDriver) {
      return <NotDriverCard userEmail={user?.email} />;
    }

    if (assignmentsError) {
      return (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <p className="text-sm text-red-600">{assignmentsError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadAssignments}
            className="mt-1"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      );
    }

    if (assignments.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
            <Truck className="w-7 h-7 text-orange-400" />
          </div>
          <p className="text-sm text-gray-500">No active assignments right now.</p>
          <p className="text-xs text-gray-400">
            {isOnline ? 'Hang tight — deliveries will appear here.' : 'Go online to start receiving deliveries.'}
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {assignments.map((a) => (
          <AssignmentCard key={a.id} assignment={a} onAction={handleAction} />
        ))}
      </div>
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100">
      {/* Top bar */}
      <div className="bg-white border-b border-orange-100 shadow-sm px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-orange-500" />
          <h1 className="text-lg font-bold text-foreground">Driver Portal</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadAssignments}
          disabled={loadingAssignments}
          className="h-8 w-8 p-0 text-gray-400 hover:text-orange-600 hover:bg-orange-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loadingAssignments ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Body */}
      <div className="px-4 py-4 max-w-lg mx-auto space-y-4">

        {/* Geolocation permission banner */}
        {geoError && (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <MapPinOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{geoError}</span>
          </div>
        )}

        {/* Shift toggle — always visible when user is (or might be) a driver */}
        {!isNotDriver && (
          <ShiftToggle
            isOnline={isOnline}
            loading={shiftLoading}
            onChange={handleShiftToggle}
          />
        )}

        {/* Assignments */}
        <div className="space-y-2">
          {!isNotDriver && assignments.length > 0 && (
            <h2 className="text-sm font-semibold text-gray-700 px-0.5">
              Active assignments ({assignments.length})
            </h2>
          )}
          {renderAssignmentsList()}
        </div>
      </div>
    </div>
  );
}
