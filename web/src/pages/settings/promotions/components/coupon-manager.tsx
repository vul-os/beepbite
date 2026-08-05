import { useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, Trash2, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { useToast } from '@/hooks/use-toast';
import { useCouponCodes, type CouponCode } from '../hooks/use-promotions';

interface CodeFormState {
  code: string;
  max_uses: number | string;
  per_customer_limit: number | string;
}

const EMPTY_CODE: CodeFormState = { code: '', max_uses: 1, per_customer_limit: '' };

export default function CouponManager({ promotionId, promotionName }: {
  promotionId: string;
  promotionName?: string;
}) {
  const { codes, loading, addCode, deleteCode } = useCouponCodes(promotionId);
  const { toast } = useToast();
  const [form, setForm] = useState<CodeFormState>(EMPTY_CODE);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [codeToDelete, setCodeToDelete] = useState<CouponCode | null>(null);

  const handleChange = <K extends keyof CodeFormState>(field: K, value: CodeFormState[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.code.trim()) { setAddError('Code is required.'); return; }
    setSaving(true);
    setAddError('');
    try {
      // NOTE: per_customer_limit is not a column on coupon_codes (see
      // backend/migrations/001_baseline.sql) — the backend silently ignores
      // it. Pre-existing behavior; not fixed here (out of scope).
      // per_customer_limit isn't a field on CouponCode/addCode's declared
      // Partial<CouponCode> param, but it's spread in conditionally rather
      // than written directly in the literal — TS's excess-property check
      // doesn't apply to spread-derived properties, so it already passes
      // without a cast (confirmed by no-unnecessary-type-assertion).
      await addCode({
        code: form.code.trim().toUpperCase(),
        max_uses: form.max_uses ? parseInt(String(form.max_uses), 10) : 1,
        ...(form.per_customer_limit
          ? { per_customer_limit: parseInt(String(form.per_customer_limit), 10) }
          : {}),
      });
      setForm(EMPTY_CODE);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add coupon code.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!codeToDelete) return;
    try {
      await deleteCode(codeToDelete.id);
      toast({ title: 'Coupon code deleted.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setCodeToDelete(null);
    }
  };

  return (
    <>
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="coupons" className="border rounded-lg px-4">
        <AccordionTrigger className="text-sm font-medium">
          <span className="flex items-center gap-2">
            <Ticket className="h-4 w-4 text-muted-foreground" />
            Coupon Codes
            {codes.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {codes.length}
              </Badge>
            )}
          </span>
        </AccordionTrigger>

        <AccordionContent className="pt-2 pb-4 space-y-4">
          {/* Existing codes */}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading codes…</p>
          ) : codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No codes yet.</p>
          ) : (
            <div className="space-y-2">
              {codes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <code className="font-mono font-semibold">{c.code}</code>
                    <span className="text-muted-foreground">
                      {c.used_count ?? 0}/{c.max_uses ?? '∞'} uses
                    </span>
                    {!c.is_active && (
                      <Badge variant="outline" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => setCodeToDelete(c)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add code form */}
          <form onSubmit={handleAdd} className="rounded-md border p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Add code
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3 sm:col-span-1">
                <Label htmlFor={`cc-code-${promotionId}`} className="text-xs">
                  Code *
                </Label>
                <Input
                  id={`cc-code-${promotionId}`}
                  value={form.code}
                  onChange={(e) => handleChange('code', e.target.value)}
                  placeholder="SUMMER20"
                  className="uppercase h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor={`cc-max-${promotionId}`} className="text-xs">
                  Max uses
                </Label>
                <Input
                  id={`cc-max-${promotionId}`}
                  type="number"
                  min="1"
                  value={form.max_uses}
                  onChange={(e) => handleChange('max_uses', e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor={`cc-per-${promotionId}`} className="text-xs">
                  Per-customer limit
                </Label>
                <Input
                  id={`cc-per-${promotionId}`}
                  type="number"
                  min="1"
                  value={form.per_customer_limit}
                  onChange={(e) => handleChange('per_customer_limit', e.target.value)}
                  placeholder="∞"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            {addError && (
              <p className="text-xs text-destructive">{addError}</p>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              {saving ? 'Adding…' : 'Add code'}
            </Button>
          </form>
        </AccordionContent>
      </AccordionItem>
    </Accordion>

      <AlertDialog open={Boolean(codeToDelete)} onOpenChange={(v) => !v && setCodeToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete coupon code?</AlertDialogTitle>
            <AlertDialogDescription>
              {codeToDelete && (
                <>
                  "{codeToDelete.code}" will be permanently deleted
                  {promotionName ? ` from ${promotionName}` : ''}. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
