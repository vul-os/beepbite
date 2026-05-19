// use-house-account.js — fetch and mutate house-account data.
// All REST calls go through api.request() hitting the Go backend.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

// ---- List hook (used by the list page) ----

export function useHouseAccounts(orgId) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const fetchAccounts = useCallback(async () => {
    if (!orgId) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.request(
        'GET',
        `/data/house_accounts?eq=organization_id,${orgId}&order=created_at.desc`,
      );
      if (!mounted.current) return;
      if (res.error) throw new Error(res.error.message || 'Failed to load accounts');
      setAccounts(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message || String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    mounted.current = true;
    fetchAccounts();
    return () => { mounted.current = false; };
  }, [fetchAccounts]);

  const createAccount = useCallback(async (body) => {
    const res = await api.request('POST', '/house-accounts', { body });
    if (res.error) throw new Error(res.error.message || 'Failed to create account');
    await fetchAccounts();
    return res.data;
  }, [fetchAccounts]);

  return { accounts, loading, error, refresh: fetchAccounts, createAccount };
}

// ---- Detail hook (used by the detail page) ----

export function useHouseAccountDetail(id) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.request('GET', `/house-accounts/${id}`);
      if (!mounted.current) return;
      if (res.error) throw new Error(res.error.message || 'Failed to load account');
      setAccount(res.data);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message || String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    mounted.current = true;
    fetchDetail();
    return () => { mounted.current = false; };
  }, [fetchDetail]);

  // ---- members ----
  const addMember = useCallback(async (customerId, spendingLimitCents) => {
    const body = { customer_id: customerId };
    if (spendingLimitCents != null) body.spending_limit_cents = spendingLimitCents;
    const res = await api.request('POST', `/house-accounts/${id}/members`, { body });
    if (res.error) throw new Error(res.error.message || 'Failed to add member');
    await fetchDetail();
    return res.data;
  }, [id, fetchDetail]);

  const removeMember = useCallback(async (customerId) => {
    const res = await api.request('DELETE', `/house-accounts/${id}/members/${customerId}`);
    if (res.error) throw new Error(res.error.message || 'Failed to remove member');
    await fetchDetail();
  }, [id, fetchDetail]);

  // ---- charges ----
  const fetchCharges = useCallback(async () => {
    const res = await api.request(
      'GET',
      `/data/house_account_charges?eq=house_account_id,${id}&order=created_at.desc`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load charges');
    return Array.isArray(res.data) ? res.data : [];
  }, [id]);

  const generateInvoice = useCallback(async () => {
    const res = await api.request('POST', `/house-accounts/${id}/invoices/generate`);
    if (res.error) throw new Error(res.error.message || 'Failed to generate invoice');
    await fetchDetail();
    return res.data;
  }, [id, fetchDetail]);

  // ---- invoices ----
  const fetchInvoices = useCallback(async () => {
    const res = await api.request('GET', `/house-accounts/${id}/invoices`);
    if (res.error) throw new Error(res.error.message || 'Failed to load invoices');
    return Array.isArray(res.data) ? res.data : [];
  }, [id]);

  const payInvoice = useCallback(async (invoiceId, paymentCents) => {
    const res = await api.request('POST', `/house-accounts/invoices/${invoiceId}/pay`, {
      body: { payment_cents: paymentCents },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to record payment');
    await fetchDetail();
    return res.data;
  }, [fetchDetail]);

  // ---- customers lookup ----
  const fetchCustomers = useCallback(async (orgId) => {
    const res = await api.request(
      'GET',
      `/data/customers?eq=organization_id,${orgId}&order=first_name.asc`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load customers');
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  return {
    account,
    loading,
    error,
    refresh: fetchDetail,
    addMember,
    removeMember,
    fetchCharges,
    generateInvoice,
    fetchInvoices,
    payInvoice,
    fetchCustomers,
  };
}
