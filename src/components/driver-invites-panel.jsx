import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Truck, Loader2, Mail, X, CheckCircle, AlertCircle, UserMinus } from 'lucide-react';
import {
  listDriverInvites, inviteDriver, revokeDriverInvite,
  listActiveDrivers, removeDriver,
} from '@/services/driver-invites';

// DriverInvitesPanel — owner/manager surface to invite drivers by email and
// manage pending invites. Drop it on the Staff management page.
export default function DriverInvitesPanel() {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [removingId, setRemovingId] = useState(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await listDriverInvites());
    } catch {
      // a non-owner/manager gets 403; just show an empty list
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    setLoadingDrivers(true);
    try {
      setDrivers(await listActiveDrivers());
    } catch {
      setDrivers([]);
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  useEffect(() => { load(); loadDrivers(); }, [load, loadDrivers]);

  const handleRemoveDriver = async (driver) => {
    if (!window.confirm(`Remove driver access for ${driver.email}? They will lose access to the Driver Portal.`)) return;
    setRemovingId(driver.profile_id);
    setMsg(null);
    try {
      await removeDriver(driver.profile_id);
      setMsg({ kind: 'ok', text: `Removed driver access for ${driver.email}.` });
      await loadDrivers();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Failed to remove driver' });
    } finally {
      setRemovingId(null);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setSubmitting(true);
    setMsg(null);
    try {
      await inviteDriver(value);
      setMsg({ kind: 'ok', text: `Invite sent to ${value}. They get driver access when they sign up with this email.` });
      setEmail('');
      await load();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Failed to invite driver' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await revokeDriverInvite(id);
      await load();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Failed to revoke invite' });
    }
  };

  return (
    <Card className="border-primary/15 bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" />
          Drivers
        </CardTitle>
        <CardDescription>
          Invite a driver by email. They get the Driver Portal automatically when they sign up with the invited address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              required
              placeholder="driver@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
              aria-label="Driver email"
            />
          </div>
          <Button type="submit" disabled={submitting || !email.trim()}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Invite driver'}
          </Button>
        </form>

        {msg && (
          <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${msg.kind === 'ok' ? 'bg-[hsl(var(--beepbite-success))]/10 text-[hsl(var(--beepbite-success))] border border-[hsl(var(--beepbite-success))]/30' : 'bg-destructive/10 text-destructive border border-destructive/30'}`}>
            {msg.kind === 'ok' ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Pending invites</h4>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending driver invites.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.status || 'pending'}
                      {inv.created_at ? ` · ${new Date(inv.created_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">driver</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(inv.id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      aria-label={`Revoke invite for ${inv.email}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Active drivers</h4>
          {loadingDrivers ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : drivers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active drivers yet. Invited drivers appear here once they sign up.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {drivers.map((d) => (
                <li key={d.profile_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{d.full_name || d.email}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {d.full_name ? d.email : 'driver'}
                      {d.joined_at ? ` · since ${new Date(d.joined_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removingId === d.profile_id}
                    onClick={() => handleRemoveDriver(d)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    aria-label={`Remove driver ${d.email}`}
                  >
                    {removingId === d.profile_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
