import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

/**
 * Fetches staff list for a location, and lazily fetches per-staff details
 * (pay rates, shifts) when a staff member is selected.
 */
export function useStaffDetail(locationId) {
  const [staffList, setStaffList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);

  const [selectedStaff, setSelectedStaff] = useState(null);

  const [rates, setRates] = useState([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [ratesError, setRatesError] = useState(null);

  const [shifts, setShifts] = useState([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [shiftsError, setShiftsError] = useState(null);

  // ── staff list ──────────────────────────────────────────────────────────────
  const fetchStaffList = useCallback(async () => {
    if (!locationId) return;
    setLoadingList(true);
    setListError(null);
    const { data, error } = await api.from('staff')
      .select('*')
      .eq('location_id', locationId)
      .order('first_name', { ascending: true });
    setLoadingList(false);
    if (error) { setListError(error.message); return; }
    setStaffList(data ?? []);
  }, [locationId]);

  useEffect(() => { fetchStaffList(); }, [fetchStaffList]);

  // ── pay rates ───────────────────────────────────────────────────────────────
  const fetchRates = useCallback(async (staffId) => {
    if (!staffId) return;
    setLoadingRates(true);
    setRatesError(null);
    const { data, error } = await api.request('GET', `/payroll/staff/${staffId}/rates`);
    setLoadingRates(false);
    if (error) { setRatesError(error.message); return; }
    setRates(data ?? []);
  }, []);

  // ── shifts (week range) ─────────────────────────────────────────────────────
  const fetchShifts = useCallback(async (staffId, weekStart, weekEnd) => {
    if (!staffId) return;
    setLoadingShifts(true);
    setShiftsError(null);
    const { data, error } = await api.from('staff_shifts')
      .select('*')
      .eq('staff_id', staffId)
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEnd)
      .order('shift_date', { ascending: true });
    setLoadingShifts(false);
    if (error) { setShiftsError(error.message); return; }
    setShifts(data ?? []);
  }, []);

  const createShift = useCallback(async (payload) => {
    const { data, error } = await api.from('staff_shifts').insert(payload);
    if (!error) await fetchShifts(
      payload.staff_id,
      payload.shift_date,
      payload.shift_date,
    );
    return { data, error };
  }, [fetchShifts]);

  const deleteShift = useCallback(async (shiftId, staffId, weekStart, weekEnd) => {
    const { error } = await api.from('staff_shifts').delete().eq('id', shiftId);
    if (!error) await fetchShifts(staffId, weekStart, weekEnd);
    return { error };
  }, [fetchShifts]);

  // ── create / patch rate helpers ─────────────────────────────────────────────
  const createRate = useCallback(async (staffId, payload) => {
    const { data, error } = await api.request('POST', `/payroll/staff/${staffId}/rates`, {
      body: payload,
    });
    if (!error) await fetchRates(staffId);
    return { data, error };
  }, [fetchRates]);

  const patchRate = useCallback(async (staffId, rateId, payload) => {
    const { data, error } = await api.request('PATCH', `/payroll/rates/${rateId}`, {
      body: payload,
    });
    if (!error) await fetchRates(staffId);
    return { data, error };
  }, [fetchRates]);

  // ── security actions ────────────────────────────────────────────────────────
  const resetPassword = useCallback(async (staffId, newPassword) => {
    const { data, error } = await api.request(
      'POST',
      `/staff/${staffId}/manager-set-password`,
      { body: { password: newPassword } },
    );
    return { data, error };
  }, []);

  const resetPin = useCallback(async (staffId, newPin) => {
    const { data, error } = await api.request(
      'POST',
      `/staff/${staffId}/set-pin`,
      { body: { pin: newPin } },
    );
    return { data, error };
  }, []);

  // ── select a staff member ───────────────────────────────────────────────────
  const selectStaff = useCallback((member) => {
    setSelectedStaff(member);
    setRates([]);
    setShifts([]);
    if (member) fetchRates(member.id);
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
