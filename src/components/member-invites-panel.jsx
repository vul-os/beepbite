import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Users, Loader2, Mail, X, CheckCircle, AlertCircle, UserMinus } from 'lucide-react';
import {
  listMemberInvites, inviteMember, revokeMemberInvite,
  listActiveMembers, removeMember,
} from '@/services/member-invites';

// Role options for the invite form (owner and driver excluded).
const ROLE_OPTIONS = [
  { value: 'manager', label: 'Manager' },
  { value: 'staff',   label: 'Staff' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'pos',     label: 'POS' },
];

// Badge colour mapping by role.
function roleBadgeClass(role) {
  switch (role) {
    case 'manager': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'staff':   return 'bg-green-50 text-green-700 border-green-200';
    case 'kitchen': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'pos':     return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'owner':   return 'bg-orange-50 text-orange-700 border-orange-200';
    default:        return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

// MemberInvitesPanel — owner/manager surface to invite org members by email+role
// and manage pending invites. Drop it on the Staff management page.
export default function MemberInvitesPanel() {
  const [invites, setInvites]               = useState([]);
  const [loading, setLoading]               = useState(true);
  const [members, setMembers]               = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [removingId, setRemovingId]         = useState(null);
  const [email, setEmail]                   = useState('');
  const [role, setRole]                     = useState('staff');
  const [submitting, setSubmitting]         = useState(false);
  const [msg, setMsg]                       = useState(null); // { kind: 'ok'|'err', text }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await listMemberInvites());
    } catch {
      // a non-owner/manager gets 403; show empty list silently
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      setMembers(await listActiveMembers());
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => { load(); loadMembers(); }, [load, loadMembers]);

  const handleInvite = async (e) => {
    e.preventDefault();
    const emailVal = email.trim();
    if (!emailVal || !role) return;
    setSubmitting(true);
    setMsg(null);
    try {
      await inviteMember(emailVal, role);
      setMsg({
        kind: 'ok',
        text: `Invite sent to ${emailVal} as ${role}. They get access when they sign up with this email.`,
      });
      setEmail('');
      await load();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Failed to invite member' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await revokeMemberInvite(id);
      await load();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Failed to revoke invite' });
    }
  };

  const handleRemoveMember = async (member) => {
    if (!window.confirm(`Remove ${member.full_name || member.email} from the team? They will lose access immediately.`)) return;
    setRemovingId(member.profile_id);
    setMsg(null);
    try {
      await removeMember(member.profile_id);
      setMsg({ kind: 'ok', text: `Removed ${member.email} from the team.` });
      await loadMembers();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Failed to remove member' });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card className="border-blue-100 bg-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-500" />
          Team Members
        </CardTitle>
        <CardDescription>
          Invite a team member by email and assign their role. They get access automatically when they sign up with the invited address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Invite form */}
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="email"
              required
              placeholder="member@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
              aria-label="Member email"
            />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-full sm:w-36 border-gray-200 focus:ring-blue-200 focus:border-blue-300">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="submit"
            disabled={submitting || !email.trim()}
            className="bg-blue-500 hover:bg-blue-600 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Invite'}
          </Button>
        </form>

        {/* Feedback message */}
        {msg && (
          <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${msg.kind === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {msg.kind === 'ok'
              ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        {/* Pending invites */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Pending invites</h4>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-gray-500">No pending invites.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{inv.email}</p>
                    <p className="text-xs text-gray-500">
                      {inv.status || 'pending'}
                      {inv.created_at ? ` · ${new Date(inv.created_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs ${roleBadgeClass(inv.role)}`}>
                      {inv.role}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(inv.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
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

        {/* Active members */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Active team members</h4>
          {loadingMembers ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-500">No active members yet. Invited members appear here once they sign up.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {members.map((m) => (
                <li key={m.profile_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.full_name || m.email}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {m.full_name ? m.email : ''}
                      {m.joined_at ? `${m.full_name ? ' · ' : ''}since ${new Date(m.joined_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs ${roleBadgeClass(m.role)}`}>
                      {m.role}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removingId === m.profile_id}
                      onClick={() => handleRemoveMember(m)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      aria-label={`Remove ${m.email}`}
                    >
                      {removingId === m.profile_id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <UserMinus className="w-4 h-4" />}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
