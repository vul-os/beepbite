import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { ZA_BANKS } from './banks';

const STEP_BANK = 1;
const STEP_DETAILS = 2;

export function AddAccountWizard({ open, onOpenChange, orgId, locationId, onSuccess }) {
  const { toast } = useToast();
  const [step, setStep] = useState(STEP_BANK);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 state
  const [selectedBankCode, setSelectedBankCode] = useState('');

  // Step 2 state
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [currency, setCurrency] = useState('ZAR');
  const [errors, setErrors] = useState({});

  const selectedBank = ZA_BANKS.find((b) => b.code === selectedBankCode);

  function reset() {
    setStep(STEP_BANK);
    setSelectedBankCode('');
    setAccountName('');
    setAccountNumber('');
    setCurrency('ZAR');
    setErrors({});
  }

  function handleClose(v) {
    if (!v) reset();
    onOpenChange(v);
  }

  function validateStep2() {
    const errs = {};
    if (!accountName.trim()) errs.accountName = 'Account holder name is required.';
    if (!/^\d{9,12}$/.test(accountNumber.trim()))
      errs.accountNumber = 'Account number must be 9–12 digits.';
    if (!currency.trim()) errs.currency = 'Currency is required.';
    return errs;
  }

  async function handleSubmit() {
    const errs = validateStep2();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        org_id: orgId,
        bank_code: selectedBank.code,
        bank_name: selectedBank.name,
        account_number: accountNumber.trim(),
        account_name: accountName.trim(),
        currency: currency.trim().toUpperCase(),
      };
      if (locationId) body.location_id = locationId;

      const { data, error } = await api.request('POST', '/bank-accounts', { body });
      if (error) {
        toast({
          variant: 'destructive',
          title: 'Failed to add bank account',
          description: error.message,
        });
        return;
      }

      const recipientId = data?.provider_recipient_id ?? data?.id ?? '';
      toast({
        title: 'Bank account added',
        description: `Created — recipient id ${recipientId}`,
      });
      handleClose(false);
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === STEP_BANK ? 'Select your bank' : 'Account details'}
          </DialogTitle>
          <DialogDescription>
            Step {step} of 2
          </DialogDescription>
        </DialogHeader>

        {step === STEP_BANK && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bank-select">Bank</Label>
              <Select value={selectedBankCode} onValueChange={setSelectedBankCode}>
                <SelectTrigger id="bank-select">
                  <SelectValue placeholder="Choose a bank..." />
                </SelectTrigger>
                <SelectContent>
                  {ZA_BANKS.map((bank) => (
                    <SelectItem key={bank.code} value={bank.code}>
                      {bank.name} ({bank.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === STEP_DETAILS && (
          <div className="space-y-4 py-2">
            {selectedBank && (
              <p className="text-sm text-muted-foreground">
                Bank: <span className="font-medium text-foreground">{selectedBank.name}</span>
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="account-name">Account holder name</Label>
              <Input
                id="account-name"
                placeholder="e.g. John's Restaurant Pty Ltd"
                value={accountName}
                onChange={(e) => {
                  setAccountName(e.target.value);
                  setErrors((prev) => ({ ...prev, accountName: undefined }));
                }}
              />
              {errors.accountName && (
                <p className="text-xs text-destructive">{errors.accountName}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account-number">Account number</Label>
              <Input
                id="account-number"
                placeholder="9–12 digits"
                inputMode="numeric"
                value={accountNumber}
                onChange={(e) => {
                  setAccountNumber(e.target.value.replace(/\D/g, ''));
                  setErrors((prev) => ({ ...prev, accountNumber: undefined }));
                }}
                maxLength={12}
              />
              {errors.accountNumber && (
                <p className="text-xs text-destructive">{errors.accountNumber}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ZAR">ZAR — South African Rand</SelectItem>
                  <SelectItem value="USD">USD — US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR — Euro</SelectItem>
                </SelectContent>
              </Select>
              {errors.currency && (
                <p className="text-xs text-destructive">{errors.currency}</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === STEP_DETAILS && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(STEP_BANK)}
              disabled={submitting}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}

          {step === STEP_BANK && (
            <Button
              type="button"
              onClick={() => setStep(STEP_DETAILS)}
              disabled={!selectedBankCode}
            >
              Next
            </Button>
          )}

          {step === STEP_DETAILS && (
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
