import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Building2, Plus, Edit, Search, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useSuppliers } from './hooks/use-suppliers';
import { SupplierForm } from './components/supplier-form';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

export default function SuppliersPage() {
  const { activeOrganization } = useAuth();
  const { suppliers, loading, error, createSupplier, updateSupplier, getPrimaryContact } = useSuppliers(activeOrganization?.id);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  if (!activeOrganization) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Select an organisation to manage suppliers.</p>
      </div>
    );
  }

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSubmit(payload) {
    setSaving(true);
    setSaveErr('');
    try {
      // _contact holds { name, email, phone } destined for supplier_contacts.
      // _address is reserved for future address storage; stripped for now.
      const { _contact, _address, ...rest } = payload;
      if (editTarget) {
        await updateSupplier(editTarget.id, {
          ...rest,
          _contact,
          _existingContactId: editTarget.primaryContact?.id || null,
        });
      } else {
        await createSupplier({ ...rest, _contact });
      }
      setModalOpen(false);
      setEditTarget(null);
    } catch (e) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setEditTarget(null);
    setSaveErr('');
    setModalOpen(true);
  }

  async function openEdit(sup) {
    setSaveErr('');
    // Fetch primary contact so the form can prefill the contact fields.
    const primaryContact = await getPrimaryContact(sup.id);
    setEditTarget({ ...sup, primaryContact: primaryContact || null });
    setModalOpen(true);
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Building2}
        title="Suppliers"
        description={`Manage vendor master for ${activeOrganization.name}`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" /> New Supplier
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search suppliers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* States */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-destructive bg-destructive/10 border border-destructive/20 rounded p-3">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {search ? 'No suppliers match your search.' : 'No suppliers yet. Create the first one.'}
            </p>
            {!search && (
              <Button onClick={openCreate} className="mt-4">
                <Plus className="w-4 h-4 mr-2" /> New Supplier
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((sup) => (
            <Card key={sup.id} variant="interactive">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-semibold text-foreground">{sup.name}</CardTitle>
                  {/* Active/inactive is a healthy-vs-dormant signal, not a
                      warning or an error — success for active, a plain
                      secondary chip once a supplier is retired. */}
                  <Badge variant={sup.is_active ? 'success' : 'secondary'}>
                    {sup.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {sup.display_name && <p className="text-xs text-muted-foreground">{sup.display_name}</p>}
              </CardHeader>
              <CardContent className="text-sm space-y-1 text-muted-foreground">
                {sup.payment_terms_days != null && (
                  <p>Net {sup.payment_terms_days} days</p>
                )}
                {sup.website && (
                  <a href={sup.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline block truncate">
                    {sup.website}
                  </a>
                )}
                <div className="pt-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(sup)} className="border-primary/25 text-primary hover:bg-primary/10">
                    <Edit className="w-3 h-3 mr-1" /> Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={modalOpen} onOpenChange={(v) => { if (!v) { setModalOpen(false); setEditTarget(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Supplier' : 'New Supplier'}</DialogTitle>
            <DialogDescription>
              {editTarget ? `Editing ${editTarget.name}` : 'Add a new supplier to your organisation.'}
            </DialogDescription>
          </DialogHeader>
          {saveErr && <p className="text-sm text-destructive -mt-2">{saveErr}</p>}
          <SupplierForm
            initial={editTarget}
            onSubmit={handleSubmit}
            onCancel={() => { setModalOpen(false); setEditTarget(null); }}
            saving={saving}
          />
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
