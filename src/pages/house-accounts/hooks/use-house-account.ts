// use-house-account.js — fetch and mutate house-account data.
// All REST calls go through api.request() hitting the Go backend.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import type { HouseAccountCharge } from '../components/charges-tab';
import type { HouseAccountInvoice } from '../components/record-payment-dialog';

// Mirrors backend/internal/handlers/houseaccounts/store.go HouseAccount.
export interface HouseAccount {
  id: string;
  organization_id: string;
  account_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_address: string | null;
  credit_limit_cents: number | null;
  current_balance_cents: number;
  currency: string;
  billing_cycle: 'monthly' | 'weekly' | 'on_demand';
  net_terms_days: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/internal/handlers/houseaccounts/store.go Member.
export interface HouseAccountMember {
  id: string;
  house_account_id: string;
  customer_id: string;
  spending_limit_cents: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/internal/handlers/houseaccounts/store.go HouseAccountDetail.
export interface HouseAccountDetail extends HouseAccount {
  members: HouseAccountMember[];
  outstanding_balance_cents: number;
}

// Mirrors backend/migrations/001_baseline.sql `customers` table (subset used
// by the member-add customer picker).
export interface Customer {
  id: string;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  [key: string]: unknown;
}

// ---- List hook (used by the list page) ----

export function useHouseAccounts(orgId: string | undefined) {
  const [accounts, setAccounts] = useState<HouseAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchAccounts = useCallback(async () => {
    if (!orgId) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.request<HouseAccount[]>(
        'GET',
        `/data/house_accounts?eq=organization_id,${orgId}&order=created_at.desc`,
      );
      if (!mounted.current) return;
      if (res.error) throw new Error(res.error.message || 'Failed to load accounts');
      setAccounts(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    mounted.current = true;
    fetchAccounts();
    return () => { mounted.current = false; };
  }, [fetchAccounts]);

  const createAccount = useCallback(async (body: Partial<HouseAccount>) => {
    const res = await api.request<HouseAccount>('POST', '/house-accounts', { body });
    if (res.error) throw new Error(res.error.message || 'Failed to create account');
    await fetchAccounts();
    return res.data;
  }, [fetchAccounts]);

  return { accounts, loading, error, refresh: fetchAccounts, createAccount };
}

// ---- Detail hook (used by the detail page) ----

export function useHouseAccountDetail(id: string | undefined) {
  const [account, setAccount] = useState<HouseAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.request<HouseAccountDetail>('GET', `/house-accounts/${id}`);
      if (!mounted.current) return;
      if (res.error) throw new Error(res.error.message || 'Failed to load account');
      setAccount(res.data);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
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
  const addMember = useCallback(async (customerId: string, spendingLimitCents?: number) => {
    const body: { customer_id: string; spending_limit_cents?: number } = { customer_id: customerId };
    if (spendingLimitCents != null) body.spending_limit_cents = spendingLimitCents;
    const res = await api.request<HouseAccountMember>('POST', `/house-accounts/${id}/members`, { body });
    if (res.error) throw new Error(res.error.message || 'Failed to add member');
    await fetchDetail();
    return res.data;
  }, [id, fetchDetail]);

  const removeMember = useCallback(async (customerId: string) => {
    const res = await api.request('DELETE', `/house-accounts/${id}/members/${customerId}`);
    if (res.error) throw new Error(res.error.message || 'Failed to remove member');
    await fetchDetail();
  }, [id, fetchDetail]);

  // ---- charges ----
  const fetchCharges = useCallback(async () => {
    const res = await api.request<HouseAccountCharge[]>(
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
    const res = await api.request<HouseAccountInvoice[]>('GET', `/house-accounts/${id}/invoices`);
    if (res.error) throw new Error(res.error.message || 'Failed to load invoices');
    return Array.isArray(res.data) ? res.data : [];
  }, [id]);

  const payInvoice = useCallback(async (invoiceId: string, paymentCents: number) => {
    const res = await api.request('POST', `/house-accounts/invoices/${invoiceId}/pay`, {
      body: { payment_cents: paymentCents },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to record payment');
    await fetchDetail();
    return res.data;
  }, [fetchDetail]);

  // ---- customers lookup ----
  const fetchCustomers = useCallback(async (orgId: string) => {
    const res = await api.request<Customer[]>(
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
