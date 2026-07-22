import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { KeyRound, Hash, AlertTriangle } from 'lucide-react';

// ── Password reset dialog ────────────────────────────────────────────────────

function ResetPasswordDialog({ staff, open, onOpenChange, onSubmit }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const reset = () => { setPw(''); setConfirm(''); setError(''); setSuccess(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (pw !== confirm) { setError('Passwords do not match.'); return; }
    setSaving(true);
    setError('');
    const { error: apiErr } = await onSubmit(pw);
    setSaving(false);
    if (apiErr) {
      setError(apiErr.message);
      return;
    }
    setSuccess(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            Reset password
          </DialogTitle>
          <DialogDescription>
            Set a new password for {staff.first_name} {staff.last_name}.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-4 text-center space-y-3">
            <p className="text-sm text-success font-medium">Password updated successfully.</p>
            <Button
              onClick={() => { reset(); onOpenChange(false); }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="new_pw">New password</Label>
              <Input
                id="new_pw"
                type="password"
                autoComplete="new-password"
                placeholder="Min. 8 characters"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm_pw">Confirm password</Label>
              <Input
                id="confirm_pw"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-primary/20 text-primary hover:bg-primary/10"
                onClick={() => { reset(); onOpenChange(false); }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="flex-1"
              >
                {saving ? 'Saving…' : 'Set password'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── PIN reset dialog ─────────────────────────────────────────────────────────

function ResetPinDialog({ staff, open, onOpenChange, onSubmit }) {
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const reset = () => { setPin(''); setError(''); setSuccess(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      setError('PIN must be 4–6 digits.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: apiErr } = await onSubmit(pin);
    setSaving(false);
    if (apiErr) { setError(apiErr.message); return; }
    setSuccess(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-primary" />
            Reset PIN
          </DialogTitle>
          <DialogDescription>
            Set a new 4–6 digit PIN for {staff.first_name} {staff.last_name}.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-4 text-center space-y-3">
            <p className="text-sm text-success font-medium">PIN updated successfully.</p>
            <Button
              onClick={() => { reset(); onOpenChange(false); }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="pin">New PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                placeholder="4–6 digits"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-primary/20 text-primary hover:bg-primary/10"
                onClick={() => { reset(); onOpenChange(false); }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="flex-1"
              >
                {saving ? 'Saving…' : 'Set PIN'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function SecurityTab({ staff, resetPassword, resetPin }) {
  const [pwOpen, setPwOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const handleResetPassword = async (newPassword) => {
    return resetPassword(staff.id, newPassword, null /* set_by: pass manager id when available */);
  };

  const handleResetPin = async (newPin) => {
    return resetPin(staff.id, newPin, null);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Use these actions to set credentials for{' '}
        <span className="font-medium text-foreground">{staff.first_name} {staff.last_name}</span>.
        The change takes effect immediately on the next sign-in.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Password card */}
        <Card className="border-primary/15 hover:border-primary/25 transition-colors">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <KeyRound className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Password</p>
                <p className="text-xs text-muted-foreground">Used for staff app login</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-primary/20 text-primary hover:bg-primary/10"
              onClick={() => setPwOpen(true)}
            >
              Reset password
            </Button>
          </CardContent>
        </Card>

        {/* PIN card */}
        <Card className="border-primary/15 hover:border-primary/25 transition-colors">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Hash className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">PIN</p>
                <p className="text-xs text-muted-foreground">Fast register sign-in (4–6 digits)</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-primary/20 text-primary hover:bg-primary/10"
              onClick={() => setPinOpen(true)}
            >
              Reset PIN
            </Button>
          </CardContent>
        </Card>
      </div>

      <ResetPasswordDialog
        staff={staff}
        open={pwOpen}
        onOpenChange={setPwOpen}
        onSubmit={handleResetPassword}
      />
      <ResetPinDialog
        staff={staff}
        open={pinOpen}
        onOpenChange={setPinOpen}
        onSubmit={handleResetPin}
      />
    </div>
  );
}
