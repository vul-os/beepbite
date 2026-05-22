// Driver-invite service — owner/manager invites a driver by email.
//
// Backend (org-scoped JWT, owner/manager role):
//   POST   /driver-invites              { email }      → create
//   GET    /driver-invites                              → list pending
//   POST   /driver-invites/{id}/revoke                  → revoke
//
// On the driver's side: they sign up with the invited email and the invite
// auto-accepts (AcceptMatchingInvites), granting driver-role + can_drive.
import { api } from '@/lib/api-client';

export async function listDriverInvites() {
  const { data, error } = await api.request('GET', '/driver-invites');
  if (error) throw new Error(error.message || 'Failed to load driver invites');
  return Array.isArray(data) ? data : (data?.invites ?? []);
}

export async function inviteDriver(email) {
  const { data, error } = await api.request('POST', '/driver-invites', {
    body: { email: String(email || '').trim() },
  });
  if (error) {
    const e = new Error(error.message || 'Failed to invite driver');
    e.status = error.status;
    throw e;
  }
  return data;
}

export async function revokeDriverInvite(id) {
  const { error } = await api.request('POST', `/driver-invites/${id}/revoke`);
  if (error) throw new Error(error.message || 'Failed to revoke invite');
}

// Active drivers (accepted members with role=driver).
export async function listActiveDrivers() {
  const { data, error } = await api.request('GET', '/drivers');
  if (error) throw new Error(error.message || 'Failed to load drivers');
  return Array.isArray(data) ? data : (data?.drivers ?? []);
}

export async function removeDriver(profileId) {
  const { error } = await api.request('DELETE', `/drivers/${profileId}`);
  if (error) throw new Error(error.message || 'Failed to remove driver');
}
