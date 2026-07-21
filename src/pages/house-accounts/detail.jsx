import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';
import { useHouseAccountDetail } from './hooks/use-house-account';
import { MembersTab } from './components/members-tab';
import { ChargesTab } from './components/charges-tab';
import { InvoicesTab } from './components/invoices-tab';
import { ArrowLeft, Building2, Loader2, AlertCircle } from 'lucide-react';

export default function HouseAccountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeOrganization } = useAuth();
  const { format: formatMoneyValue } = useMoney();
  const centsToDisplay = (cents) => (cents == null ? '—' : formatMoneyValue(cents));

  const {
    account,
    loading,
    error,
    addMember,
    removeMember,
    fetchCharges,
    generateInvoice,
    fetchInvoices,
    payInvoice,
    fetchCustomers,
  } = useHouseAccountDetail(id);

  if (loading) {
    return (
      <div className="flex items-center gap-2 justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading account…
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-destructive">{error || 'Account not found'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/house-accounts')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to accounts
        </Button>
      </div>
    );
  }

  const outstanding = account.outstanding_balance_cents ?? 0;
  const limit = account.credit_limit_cents;
  const utilization = limit && limit > 0 ? Math.min(100, Math.round((outstanding / limit) * 100)) : null;
  const orgId = activeOrganization?.id ?? account.organization_id;

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <Button variant="ghost" size="sm" onClick={() => navigate('/house-accounts')} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        House accounts
      </Button>

      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 text-muted-foreground" />
              <div>
                <CardTitle className="text-xl">{account.account_name}</CardTitle>
                {account.contact_name && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {account.contact_name}
                    {account.contact_email && ` · ${account.contact_email}`}
                  </p>
                )}
              </div>
            </div>
            <Badge variant={account.is_active ? 'default' : 'secondary'}>
              {account.is_active ? 'active' : 'inactive'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding</p>
              <p className="text-2xl font-bold">{centsToDisplay(outstanding)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Credit limit</p>
              <p className="text-2xl font-bold">{centsToDisplay(limit)}</p>
            </div>
            {account.net_terms_days != null && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Net terms</p>
                <p className="text-2xl font-bold">Net {account.net_terms_days}</p>
              </div>
            )}
          </div>

          {utilization != null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Credit utilisation</span>
                <span>{utilization}%</span>
              </div>
              <Progress
                value={utilization}
                className={utilization >= 90 ? '[&>div]:bg-destructive' : utilization >= 70 ? '[&>div]:bg-amber-500' : ''}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members ({(account.members ?? []).length})</TabsTrigger>
          <TabsTrigger value="charges">Charges</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <MembersTab
            members={account.members ?? []}
            orgId={orgId}
            addMember={addMember}
            removeMember={removeMember}
            fetchCustomers={fetchCustomers}
          />
        </TabsContent>

        <TabsContent value="charges" className="mt-4">
          <ChargesTab
            accountId={id}
            fetchCharges={fetchCharges}
            generateInvoice={generateInvoice}
          />
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <InvoicesTab
            accountId={id}
            fetchInvoices={fetchInvoices}
            payInvoice={payInvoice}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
