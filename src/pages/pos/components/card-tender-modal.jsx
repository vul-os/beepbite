import { useState, useEffect } from "react"
import { CreditCard, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

function formatRands(cents) {
  return `R ${(cents / 100).toFixed(2)}`
}

export function CardTenderModal({
  open,
  onOpenChange,
  amountDueCents,
  submitting = false,
  errorMessage,
  onConfirm,
}) {
  const [reference, setReference] = useState("")
  const [confirmed, setConfirmed] = useState(false)

  // Reset internal state each time the modal opens
  useEffect(() => {
    if (open) {
      setReference("")
      setConfirmed(false)
    }
  }, [open])

  function handleConfirm() {
    if (!confirmed || submitting) return
    onConfirm({ amountCents: amountDueCents, reference: reference.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-orange-500" />
            Card Payment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Instruction */}
          <p className="text-sm text-muted-foreground">
            Process the payment on the card terminal, then confirm below.
          </p>

          {/* Amount due */}
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-orange-600">
              Amount due
            </p>
            <p className="mt-1 text-3xl font-bold text-orange-500">
              {formatRands(amountDueCents)}
            </p>
          </div>

          {/* Optional reference */}
          <div className="space-y-1.5">
            <Input
              id="card-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional: terminal ref"
              maxLength={50}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Helps reconcile with the bank statement.
            </p>
          </div>

          {/* Confirmation checkbox */}
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              confirmed
                ? "border-orange-300 bg-orange-50"
                : "border-border bg-background hover:bg-muted/40",
              submitting && "pointer-events-none opacity-60"
            )}
          >
            <div
              role="checkbox"
              aria-checked={confirmed}
              tabIndex={0}
              onClick={() => !submitting && setConfirmed((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault()
                  if (!submitting) setConfirmed((v) => !v)
                }
              }}
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                confirmed
                  ? "border-orange-500 bg-orange-500 text-white"
                  : "border-muted-foreground/40"
              )}
            >
              {confirmed && <CheckCircle2 className="h-3.5 w-3.5" />}
            </div>
            <span className="text-sm leading-snug">
              I confirm the card transaction was approved on the terminal
            </span>
          </label>

          {/* Error alert */}
          {errorMessage && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!confirmed || submitting}
            className="bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              "Mark as Paid"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
