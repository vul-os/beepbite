// category-86-button.jsx — toggle button that 86s or un-86s an entire
// category (and all its subcategories) with a confirmation dialog before
// committing.
//
// Props:
//   category      {object}   — must have { id, name }
//   allItems      {Array}    — items in the category (used to derive current state)
//   onComplete    {function} — called after a successful toggle with
//                             { items_affected, is_86ed } so the parent can
//                             refresh its data
//   disabled      {boolean}  — optional; disables the button when true

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { eightySixCategory, unEightySixCategory } from '@/services/category86';

/**
 * A button that 86s or un-86s the entire category after a confirmation dialog.
 *
 * @param {{ category: {id: string, name: string}, allItems: Array, onComplete?: Function, disabled?: boolean }} props
 */
export function Category86Button({ category, allItems = [], onComplete, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Derive whether the category is "currently 86'd" by checking if ALL active
  // items in the list are marked is_86ed. If there are no items we fall back to
  // false so the button reads "86 this category".
  const is86ed = useMemo(() => {
    if (!allItems.length) return false;
    return allItems.every((item) => item.is_86ed);
  }, [allItems]);

  const action = is86ed ? 'un-86' : '86';
  const actionLabel = is86ed ? 'Un-86 Category' : '86 This Category';

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      const { data, error: apiError } = is86ed
        ? await unEightySixCategory(category.id)
        : await eightySixCategory(category.id);

      if (apiError) {
        setError(apiError.message || 'Something went wrong. Please try again.');
        return;
      }

      setOpen(false);
      if (onComplete) {
        onComplete({ items_affected: data?.items_affected ?? 0, is_86ed: data?.is_86ed ?? !is86ed });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={is86ed ? 'outline' : 'destructive'}
        size="sm"
        disabled={disabled || busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="gap-1.5"
      >
        {is86ed ? (
          <>
            <CheckCircle className="h-3.5 w-3.5" />
            Un-86
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            86 Category
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {is86ed ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              {is86ed ? 'Un-86 Category' : '86 This Category'}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-1">
                <p>
                  {is86ed ? (
                    <>
                      Mark all items in{' '}
                      <span className="font-semibold text-foreground">
                        {category.name}
                      </span>{' '}
                      as <span className="font-semibold text-green-600">available</span> again?
                    </>
                  ) : (
                    <>
                      Mark all items in{' '}
                      <span className="font-semibold text-foreground">
                        {category.name}
                      </span>{' '}
                      as <span className="font-semibold text-destructive">86'd (unavailable)</span>?
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  This includes all subcategories. You can reverse this at any time.
                </p>
                {allItems.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Badge variant="secondary" className="text-xs">
                      {allItems.length} item{allItems.length !== 1 ? 's' : ''} affected
                    </Badge>
                  </div>
                )}
                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={is86ed ? 'default' : 'destructive'}
              onClick={handleConfirm}
              disabled={busy}
              className="gap-1.5"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirm {action === 'un-86' ? 'Un-86' : '86'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default Category86Button;
