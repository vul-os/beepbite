import React, { useState } from 'react';
import {
  Tag,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { usePromotions } from './hooks/use-promotions';
import PromotionForm from './components/promotion-form';
import CouponManager from './components/coupon-manager';

// ---- helpers ----

const TYPE_LABELS = {
  percent_off:      'Percent off',
  fixed_off:        'Fixed off',
  bogo:             'BOGO',
  free_item:        'Free item',
  happy_hour_price: 'Happy-hour price',
  free_delivery:    'Free delivery',
};

const SCOPE_LABELS = {
  order:    'Order',
  item:     'Item',
  category: 'Category',
  delivery: 'Delivery',
};

function fmtDate(iso) {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd MMM yyyy'); } catch { return iso; }
}

function statusBadge(promo) {
  if (!promo.is_active) return <Badge variant="secondary">Inactive</Badge>;
  const now = new Date();
  if (promo.active_from && parseISO(promo.active_from) > now)
    return <Badge variant="outline" className="text-yellow-600 border-yellow-400">Scheduled</Badge>;
  if (promo.active_until && parseISO(promo.active_until) < now)
    return <Badge variant="destructive">Expired</Badge>;
  return <Badge className="bg-green-100 text-green-800 border-green-200" variant="outline">Live</Badge>;
}

// ---- page component ----

export default function PromotionsPage() {
  const { activeLocation, activeOrganization } = useAuth();
  const { toast } = useToast();

  const {
    promotions,
    loading,
    error,
    createPromotion,
    updatePromotion,
    deletePromotion,
    toggleActive,
  } = usePromotions(activeLocation?.id);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, obj = edit
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [expandedCoupons, setExpandedCoupons] = useState(new Set());

  // ---- sheet actions ----

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (promo) => { setEditing(promo); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updatePromotion(editing.id, payload);
      } else {
        await createPromotion(payload);
      }
      closeSheet();
      toast({ title: editing?.id ? 'Promotion updated.' : 'Promotion created.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // ---- delete ----

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deletePromotion(toDelete.id);
      toast({ title: 'Promotion deleted.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message });
    } finally {
      setToDelete(null);
    }
  };

  // ---- coupon accordion toggle ----

  const toggleCoupons = (id) => {
    setExpandedCoupons((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ---- no location guard ----

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-1">No location selected</h2>
        <p className="text-muted-foreground">
          Please select a location to manage promotions.
        </p>
      </div>
    );
  }

  return (
    <PageContainer>

      {/* Header */}
      <PageHeader
        eyebrow="Settings"
        title="Promotions"
        description={`Manage discounts and coupon campaigns for ${activeLocation.name}.`}
        icon={Tag}
        actions={
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            New promotion
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && promotions.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No promotions yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first promotion to start offering discounts.
          </p>
          <Button variant="outline" onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            New promotion
          </Button>
        </div>
      )}

      {/* Table */}
      {!loading && promotions.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Active window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotions.map((promo) => (
                <React.Fragment key={promo.id}>
                  <TableRow>
                    <TableCell className="font-medium">
                      <Button
                        variant="link"
                        className="h-auto p-0 text-left font-medium text-foreground"
                        onClick={() => toggleCoupons(promo.id)}
                        title="Toggle coupon codes"
                      >
                        {promo.name}
                      </Button>
                      {promo.requires_coupon_code && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Coupon required
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {TYPE_LABELS[promo.promo_type] ?? promo.promo_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {SCOPE_LABELS[promo.scope] ?? promo.scope}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {fmtDate(promo.active_from)} → {fmtDate(promo.active_until)}
                    </TableCell>
                    <TableCell>{statusBadge(promo)}</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={promo.is_active}
                        onCheckedChange={() => toggleActive(promo)}
                        aria-label="Toggle active"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(promo)}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => setToDelete(promo)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Coupon manager row (inline accordion) */}
                  {expandedCoupons.has(promo.id) && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/30 py-3 px-6">
                        <CouponManager
                          promotionId={promo.id}
                          promotionName={promo.name}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>
              {editing ? 'Edit promotion' : 'New promotion'}
            </SheetTitle>
            <SheetDescription>
              {editing
                ? `Update "${editing.name}"`
                : 'Fill in the details for your new promotion.'}
            </SheetDescription>
          </SheetHeader>

          <PromotionForm
            initial={editing}
            locationId={activeLocation?.id}
            organizationId={activeOrganization?.id}
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(toDelete)} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete promotion?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
