import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Trash2, Building2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { AddAccountWizard } from './components/add-account-wizard';

export function BankAccountTab({ orgId, locationId }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, bankName, last4 }
  const [deleting, setDeleting] = useState(false);

  const fetchAccounts = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ org_id: orgId });
      if (locationId) params.set('location_id', locationId);
      const { data, error } = await api.request('GET', `/bank-accounts?${params.toString()}`);
      if (error) {
        toast({ variant: 'destructive', title: 'Failed to load bank accounts', description: error.message });
        return;
      }
      setAccounts(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [orgId, locationId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await api.request('DELETE', `/bank-accounts/${deleteTarget.id}`);
      if (error) {
        toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
        return;
      }
      toast({ title: 'Bank account removed' });
      setDeleteTarget(null);
      fetchAccounts();
    } finally {
      setDeleting(false);
    }
  }

  function statusBadge(account) {
    if (!account.is_active) return <Badge variant="secondary">Inactive</Badge>;
    if (account.verified_at) return <Badge variant="default" className="bg-green-600 text-white">Verified</Badge>;
    return <Badge variant="outline">Pending</Badge>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Bank accounts</h3>
          <p className="text-sm text-muted-foreground">Accounts used to receive payouts.</p>
        </div>
        <Button size="sm" onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add bank account
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-48 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No bank accounts yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a bank account to start receiving payouts.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium leading-none truncate">
                    {account.account_holder_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {account.bank_name}
                    {account.bank_code ? ` · ${account.bank_code}` : ''}
                    {' · '}****{account.account_number_last4}
                    {' · '}{account.currency}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {statusBadge(account)}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() =>
                      setDeleteTarget({
                        id: account.id,
                        bankName: account.bank_name,
                        last4: account.account_number_last4,
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add account wizard */}
      <AddAccountWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        orgId={orgId}
        locationId={locationId}
        onSuccess={fetchAccounts}
      />

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove bank account?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  This will deactivate{' '}
                  <span className="font-medium">{deleteTarget.bankName}</span>{' '}
                  ending in <span className="font-medium">****{deleteTarget.last4}</span>.
                  Scheduled payouts using this account may fail.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
