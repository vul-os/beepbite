import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function useBilling(orgId) {
  const [plans, setPlans] = useState([]);
  const [org, setOrg] = useState(null);
  const [fees, setFees] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [upgrading, setUpgrading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [plansRes, orgRes, feesRes, payoutsRes] = await Promise.all([
        api.request('GET', '/data/subscription_plans?eq=is_active,true&order=sort_order.asc'),
        api.request('GET', `/data/organizations?eq=id,${orgId}`),
        api.request(
          'GET',
          `/data/beepbite_payment_fees?eq=organization_id,${orgId}&gte=captured_at,${monthStart()}`
        ),
        api.request(
          'GET',
          `/data/merchant_payouts?eq=organization_id,${orgId}&order=initiated_at.desc&limit=12`
        ),
      ]);

      if (plansRes.error) throw new Error(plansRes.error.message);
      if (orgRes.error) throw new Error(orgRes.error.message);
      if (feesRes.error) throw new Error(feesRes.error.message);
      if (payoutsRes.error) throw new Error(payoutsRes.error.message);

      setPlans(Array.isArray(plansRes.data) ? plansRes.data : []);
      // org endpoint returns array; grab first element
      const orgRow = Array.isArray(orgRes.data) ? orgRes.data[0] : orgRes.data;
      setOrg(orgRow ?? null);
      setFees(Array.isArray(feesRes.data) ? feesRes.data : []);
      setPayouts(Array.isArray(payoutsRes.data) ? payoutsRes.data : []);
    } catch (err) {
      setError(err.message ?? 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const changePlan = useCallback(
    async (tierCode) => {
      if (!orgId) return { error: 'No organisation selected' };
      setUpgrading(true);
      try {
        const { data, error: patchErr } = await api.request(
          'PATCH',
          `/data/organizations?eq=id,${orgId}`,
          { body: { subscription_tier: tierCode } }
        );
        if (patchErr) return { error: patchErr.message };
        // Optimistically update org tier
        setOrg((prev) => ({ ...prev, subscription_tier: tierCode }));
        return { data };
      } finally {
        setUpgrading(false);
      }
    },
    [orgId]
  );

  // Derived: current plan object
  const currentPlan = plans.find((p) => p.tier_code === org?.subscription_tier) ?? null;

  // Derived: month summary
  const summary = {
    transactionFeesCents: fees
      .filter((f) => f.fee_kind === 'transaction')
      .reduce((acc, f) => acc + (f.fee_amount_cents ?? 0), 0),
    payoutFeesCents: fees
      .filter((f) => f.fee_kind === 'payout')
      .reduce((acc, f) => acc + (f.fee_amount_cents ?? 0), 0),
    totalPayoutsNetCents: payouts.reduce((acc, p) => acc + (p.net_cents ?? 0), 0),
  };

  return {
    plans,
    org,
    currentPlan,
    fees,
    payouts,
    summary,
    loading,
    error,
    upgrading,
    refresh: fetchAll,
    changePlan,
  };
}
