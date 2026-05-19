import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { UserPlus, Trash2, Loader2, Users } from 'lucide-react';

function customerLabel(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || c.email || c.id;
}

export function MembersTab({ members = [], orgId, addMember, removeMember, fetchCustomers }) {
  const [addOpen, setAddOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [err, setErr] = useState(null);

  // Load customers when dialog opens
  useEffect(() => {
    if (!addOpen || !orgId) return;
    setLoadingCustomers(true);
    fetchCustomers(orgId)
      .then((data) => {
        // Filter out already-added members
        const memberIds = new Set(members.map((m) => m.customer_id));
        setCustomers(data.filter((c) => !memberIds.has(c.id)));
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingCustomers(false));
  }, [addOpen, orgId, members, fetchCustomers]);

  async function handleAdd() {
    if (!selectedCustomerId) return;
    setSaving(true);
    setErr(null);
    try {
      await addMember(selectedCustomerId);
      setSelectedCustomerId('');
      setAddOpen(false);
    } catch (e) {
      setErr(e.message || 'Failed to add member');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(member) {
    if (!confirm(`Remove this member from the account?`)) return;
    setRemovingId(member.customer_id);
    try {
      await removeMember(member.customer_id);
    } catch (e) {
      alert(e.message || 'Failed to remove member');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span className="text-sm">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        </div>
        <Button size="sm" onClick={() => { setErr(null); setAddOpen(true); }}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add member
        </Button>
      </div>

      {members.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No members yet. Add customers who can charge to this account.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Spending limit</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.customer_id}</TableCell>
                <TableCell>
                  <Badge variant={m.is_active ? 'default' : 'secondary'}>
                    {m.is_active ? 'active' : 'inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {m.spending_limit_cents != null
                    ? `$${(m.spending_limit_cents / 100).toFixed(2)}`
                    : <span className="text-muted-foreground text-xs">unlimited</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(m.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={removingId === m.customer_id}
                    onClick={() => handleRemove(m)}
                  >
                    {removingId === m.customer_id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add member dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Select a customer to add as a member of this house account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label>Customer</Label>
              {loadingCustomers ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading customers…
                </div>
              ) : customers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No eligible customers found.</p>
              ) : (
                <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {customerLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving || !selectedCustomerId}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
