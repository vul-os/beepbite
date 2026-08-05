import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { Supplier, SupplierContact } from '../types';

// A contact as supplied by the create/edit form — not a full SupplierContact
// row (no id/supplier_id/is_primary/timestamps yet).
interface SupplierContactInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface SupplierCreatePayload extends Partial<Omit<Supplier, 'id' | 'created_at' | 'updated_at'>> {
  name: string;
  _contact?: SupplierContactInput;
}

export interface SupplierUpdatePayload extends Partial<Omit<Supplier, 'id' | 'created_at' | 'updated_at'>> {
  _contact?: SupplierContactInput;
  _existingContactId?: string | null;
}

// ---------------------------------------------------------------------------
// Primary-contact helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the primary contact for a supplier.
 * Prefers is_primary=true; falls back to the first row if none is flagged.
 */
async function fetchPrimaryContact(supplierId: string): Promise<SupplierContact | null> {
  const { data, error: err } = await api.from('supplier_contacts')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('is_primary', { ascending: false }) // true rows first
    .order('created_at', { ascending: true });
  if (err) return null;
  const rows: SupplierContact[] = data || [];
  return rows.find((r) => r.is_primary) || rows[0] || null;
}

/**
 * Upsert the primary contact for a supplier.
 * If an existing contact row is passed, update it; otherwise insert a new one.
 * Any pre-existing contact with is_primary=true keeps its flag — we only
 * ever touch the one row we own.
 */
async function upsertPrimaryContact(supplierId: string, contact: SupplierContactInput, existingId: string | null): Promise<void> {
  // name is NOT NULL in the schema.  Require it — if the caller provided only
  // email/phone without a name we still skip (avoids writing a nameless row).
  const hasData = !!(contact.name);
  if (!hasData) return; // nothing to write

  const payload = {
    supplier_id: supplierId,
    name: contact.name,
    email: contact.email || null,
    phone: contact.phone || null,
    is_primary: true,
  };

  if (existingId) {
    const { error: err } = await api.from('supplier_contacts')
      .update(payload)
      .eq('id', existingId);
    if (err) throw new Error(err.message);
  } else {
    const { error: err } = await api.from('supplier_contacts')
      .insert(payload);
    if (err) throw new Error(err.message);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSuppliers(organizationId: string | undefined) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!organizationId) {
      setSuppliers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await api.from('suppliers')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true });
      if (err) throw new Error(err.message);
      setSuppliers(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  // fetch() is fully try/catch/finally-wrapped above.
  useEffect(() => { void fetch(); }, [fetch]);

  /**
   * Create a supplier then write its primary contact.
   * `payload._contact` carries { name, email, phone }.
   */
  const createSupplier = useCallback(async (payload: SupplierCreatePayload) => {
    const { _contact, ...rest } = payload;
    const { data, error: err } = await api.from('suppliers')
      .insert({ ...rest, organization_id: organizationId })
      .select()
      .single();
    if (err) throw new Error(err.message);
    if (_contact) {
      await upsertPrimaryContact(data.id, _contact, null);
    }
    await fetch();
    return data;
  }, [organizationId, fetch]);

  /**
   * Update an existing supplier then upsert its primary contact.
   * `payload._contact` carries { name, email, phone }.
   * `payload._existingContactId` is the id of the current primary contact row (if any).
   */
  const updateSupplier = useCallback(async (id: string, payload: SupplierUpdatePayload) => {
    const { _contact, _existingContactId, ...rest } = payload;
    const { data, error: err } = await api.from('suppliers')
      .update(rest)
      .eq('id', id)
      .select()
      .single();
    if (err) throw new Error(err.message);
    if (_contact) {
      await upsertPrimaryContact(id, _contact, _existingContactId || null);
    }
    await fetch();
    return data;
  }, [fetch]);

  /** Fetch the primary contact for a supplier (used by the edit flow). */
  const getPrimaryContact = useCallback(fetchPrimaryContact, []);

  return { suppliers, loading, error, refetch: fetch, createSupplier, updateSupplier, getPrimaryContact };
}
