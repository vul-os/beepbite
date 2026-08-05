import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { Staff, PayRate, StaffShift, StaffShiftInput } from '../types';

/**
 * Fetches staff list for a location, and lazily fetches per-staff details
 * (pay rates, shifts) when a staff member is selected.
 */
export function useStaffDetail(locationId: string | undefined) {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);

  const [rates, setRates] = useState<PayRate[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);

  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  // ── staff list ──────────────────────────────────────────────────────────────
  // api.from()/api.request() only wrap the API-error case in
  // { data, error } — a network-level failure (fetch() itself rejecting)
  // throws instead. None of fetchStaffList/fetchRates/fetchShifts below
  // had a try/catch, so that previously skipped their setLoading*(false)
  // calls entirely, stranding whichever panel was loading forever. Same
  // systemic pattern as the other stuck-loading bugs found across this
  // codebase in this pass (home dashboard, KDS, 2FA, checkout, invoices, …).
  const fetchStaffList = useCallback(async () => {
    if (!locationId) return;
    setLoadingList(true);
    setListError(null);
    try {
      const { data, error } = await api.from('staff')
        .select('*')
        .eq('location_id', locationId)
        .order('first_name', { ascending: true });
      if (error) { setListError(error.message); return; }
      setStaffList(data ?? []);
    } catch (e) {
      console.error('Error fetching staff list:', e);
      setListError(e instanceof Error ? e.message : 'Failed to load staff.');
    } finally {
      setLoadingList(false);
    }
  }, [locationId]);

  useEffect(() => { void fetchStaffList(); }, [fetchStaffList]);

  // ── pay rates ───────────────────────────────────────────────────────────────
  const fetchRates = useCallback(async (staffId?: string) => {
    if (!staffId) return;
    setLoadingRates(true);
    setRatesError(null);
    try {
      const { data, error } = await api.request<PayRate[]>('GET', `/payroll/staff/${staffId}/rates`);
      if (error) { setRatesError(error.message); return; }
      setRates(data ?? []);
    } catch (e) {
      console.error('Error fetching pay rates:', e);
      setRatesError(e instanceof Error ? e.message : 'Failed to load pay rates.');
    } finally {
      setLoadingRates(false);
    }
  }, []);

  // ── shifts (week range) ─────────────────────────────────────────────────────
  const fetchShifts = useCallback(async (staffId: string | undefined, weekStart: string, weekEnd: string) => {
    if (!staffId) return;
    setLoadingShifts(true);
    setShiftsError(null);
    try {
      const { data, error } = await api.from('staff_shifts')
        .select('*')
        .eq('staff_id', staffId)
        .gte('shift_date', weekStart)
        .lte('shift_date', weekEnd)
        .order('shift_date', { ascending: true });
      if (error) { setShiftsError(error.message); return; }
      setShifts(data ?? []);
    } catch (e) {
      console.error('Error fetching shifts:', e);
      setShiftsError(e instanceof Error ? e.message : 'Failed to load shifts.');
    } finally {
      setLoadingShifts(false);
    }
  }, []);

  const createShift = useCallback(async (payload: StaffShiftInput) => {
    const { data, error } = await api.from('staff_shifts').insert(payload);
    if (!error) await fetchShifts(
      payload.staff_id,
      payload.shift_date,
      payload.shift_date,
    );
    return { data, error };
  }, [fetchShifts]);

  const deleteShift = useCallback(async (shiftId: string, staffId: string, weekStart: string, weekEnd: string) => {
    const { error } = await api.from('staff_shifts').delete().eq('id', shiftId);
    if (!error) await fetchShifts(staffId, weekStart, weekEnd);
    return { error };
  }, [fetchShifts]);

  // ── create / patch rate helpers ─────────────────────────────────────────────
  const createRate = useCallback(async (staffId: string, payload: unknown) => {
    const { data, error } = await api.request<PayRate>('POST', `/payroll/staff/${staffId}/rates`, {
      body: payload,
    });
    if (!error) await fetchRates(staffId);
    return { data, error };
  }, [fetchRates]);

  const patchRate = useCallback(async (staffId: string, rateId: string, payload: unknown) => {
    const { data, error } = await api.request<PayRate>('PATCH', `/payroll/rates/${rateId}`, {
      body: payload,
    });
    if (!error) await fetchRates(staffId);
    return { data, error };
  }, [fetchRates]);

  // ── security actions ────────────────────────────────────────────────────────
  const resetPassword = useCallback(async (staffId: string, newPassword: string, _setBy?: string | null) => {
    const { data, error } = await api.request(
      'POST',
      `/staff/${staffId}/manager-set-password`,
      { body: { password: newPassword } },
    );
    return { data, error };
  }, []);

  const resetPin = useCallback(async (staffId: string, newPin: string, _setBy?: string | null) => {
    const { data, error } = await api.request(
      'POST',
      `/staff/${staffId}/set-pin`,
      { body: { pin: newPin } },
    );
    return { data, error };
  }, []);

  // ── select a staff member ───────────────────────────────────────────────────
  const selectStaff = useCallback((member: Staff | null) => {
    setSelectedStaff(member);
    setRates([]);
    setShifts([]);
    // fetchRates() is now fully try/catch/finally-wrapped above.
    if (member) void fetchRates(member.id);
  }, [fetchRates]);

  return {
    // list
    staffList,
    loadingList,
    listError,
    refreshList: fetchStaffList,

    // selection
    selectedStaff,
    selectStaff,

    // rates
    rates,
    loadingRates,
    ratesError,
    fetchRates,
    createRate,
    patchRate,

    // shifts
    shifts,
    loadingShifts,
    shiftsError,
    fetchShifts,
    createShift,
    deleteShift,

    // security
    resetPassword,
    resetPin,
  };
}
