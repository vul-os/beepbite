import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';
import { useHouseAccounts } from './hooks/use-house-account';
import { AccountFormDialog } from './components/account-form';
import { Plus, Loader2, Building2, AlertCircle } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

function statusBadge(isActive) {
  return isActive
    ? <Badge variant="default">active</Badge>
    : <Badge variant="secondary">inactive</Badge>;
}

export default function HouseAccountsPage() {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();
  const orgId = activeOrganization?.id;
  const { format: formatMoneyValue } = useMoney();

  const centsToDisplay = (cents) => (cents == null ? '—' : formatMoneyValue(cents));

  const { accounts, loading, error, createAccount } = useHouseAccounts(orgId);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!activeOrganization) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-1">No organisation selected</h2>
        <p className="text-muted-foreground text-sm">Select an organisation to manage house accounts.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Building2}
        title="House Accounts"
        description={`Corporate billing accounts for ${activeOrganization.name}`}
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New account
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-destructive text-sm">{error}</CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {loading ? 'Loading…' : `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading accounts…
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No house accounts yet.</p>
              <Button variant="link" className="mt-2 text-sm" onClick={() => setDialogOpen(true)}>
                Create the first one
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Outstanding balance</TableHead>
                  <TableHead>Credit limit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/house-accounts/${a.id}`)}
                  >
                    <TableCell className="font-medium">{a.account_name}</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell>{centsToDisplay(a.current_balance_cents)}</TableCell>
                    <TableCell>{centsToDisplay(a.credit_limit_cents)}</TableCell>
                    <TableCell>{statusBadge(a.is_active)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <AccountFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orgId={orgId}
        onCreate={createAccount}
      />
    </PageContainer>
  );
}
