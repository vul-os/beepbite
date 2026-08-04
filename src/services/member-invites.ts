// Member-invite service — owner/manager invites org members by email + role.
//
// Backend (org-scoped JWT, owner/manager role):
//   POST   /member-invites              { email, role }  → create
//   GET    /member-invites                               → list pending
//   POST   /member-invites/{id}/revoke                   → revoke
//   GET    /members                                      → list active (non-driver)
//   DELETE /members/{profile_id}                         → remove member
//
// On the invitee's side: they sign up with the invited email and the invite
// auto-accepts (AcceptMatchingInvites), granting membership with role-appropriate
// default capabilities.
import { api } from '@/lib/api-client';

export interface MemberInvite {
  id: string;
  email: string;
  role: string;
  [key: string]: unknown;
}

export interface Member {
  id: string;
  [key: string]: unknown;
}

interface FetchError extends Error {
  status?: number;
}

export async function listMemberInvites(): Promise<MemberInvite[]> {
  const { data, error } = await api.request<MemberInvite[] | { invites: MemberInvite[] }>('GET', '/member-invites');
  if (error) throw new Error(error.message || 'Failed to load member invites');
  return Array.isArray(data) ? data : (data?.invites ?? []);
}

export async function inviteMember(email: string, role: string) {
  const { data, error } = await api.request<MemberInvite>('POST', '/member-invites', {
    body: {
      email: String(email || '').trim(),
      role: String(role || '').trim(),
    },
  });
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to invite member');
    e.status = error.status;
    throw e;
  }
  return data;
}

export async function revokeMemberInvite(id: string) {
  const { error } = await api.request('POST', `/member-invites/${id}/revoke`);
  if (error) throw new Error(error.message || 'Failed to revoke invite');
}

// Active members (accepted, role != driver).
export async function listActiveMembers(): Promise<Member[]> {
  const { data, error } = await api.request<Member[] | { members: Member[] }>('GET', '/members');
  if (error) throw new Error(error.message || 'Failed to load members');
  return Array.isArray(data) ? data : (data?.members ?? []);
}

export async function removeMember(profileId: string) {
  const { error } = await api.request('DELETE', `/members/${profileId}`);
  if (error) throw new Error(error.message || 'Failed to remove member');
}
