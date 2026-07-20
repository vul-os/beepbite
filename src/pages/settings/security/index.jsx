/**
 * Security Settings page — Wave 39 TOTP two-factor authentication.
 *
 * Three states:
 *   1. Not enrolled  → Show "Set up 2FA" button → enroll flow (QR code).
 *   2. Enrolled      → Show verify-code form → returns backup codes.
 *   3. Enabled       → Show status + "Disable 2FA" form.
 *
 * Route: wired externally; this file is the default export.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  KeyRound,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  getTOTPStatus,
  enrollTOTP,
  verifyTOTP,
  disableTOTP,
} from '@/services/twofa';

// ── Step enum ─────────────────────────────────────────────────────────────────

const STEP = {
  LOADING: 'loading',
  DISABLED: 'disabled',      // 2FA off, not enrolled
  ENROLLING: 'enrolling',    // otpauth URL shown, waiting for verification
  VERIFYING: 'verifying',    // submitting code
  BACKUP_SHOWN: 'backup',    // newly generated backup codes visible
  ENABLED: 'enabled',        // 2FA on
  DISABLING: 'disabling',    // form to disable
};

// ── Backup code copy helper ──────────────────────────────────────────────────

function BackupCodes({ codes }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <div
            key={c}
            className="bg-muted rounded px-3 py-1.5 tracking-widest text-center select-all"
          >
            {c}
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy all'}
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SecuritySettings() {
  const [step, setStep] = useState(STEP.LOADING);
  const [otpauthURL, setOtpauthURL] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [backupRemaining, setBackupRemaining] = useState(0);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableBackup, setDisableBackup] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const clearError = () => setError('');

  // Load current status on mount.
  const loadStatus = useCallback(async () => {
    setStep(STEP.LOADING);
    const { data, error: err } = await getTOTPStatus();
    if (err) {
      setError(err.message || 'Failed to load 2FA status');
      setStep(STEP.DISABLED);
      return;
    }
    if (data.enabled) {
      setBackupRemaining(data.backup_codes_remaining);
      setStep(STEP.ENABLED);
    } else if (data.enrolled) {
      // Has a pending secret but hasn't verified yet — show enroll flow again.
      setStep(STEP.DISABLED);
    } else {
      setStep(STEP.DISABLED);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // ── Enroll: generate TOTP secret + QR code ────────────────────────────────

  const handleEnroll = async () => {
    clearError();
    setBusy(true);
    const { data, error: err } = await enrollTOTP();
    setBusy(false);
    if (err) {
      setError(err.message || 'Failed to start enrollment');
      return;
    }
    setOtpauthURL(data.otpauth_url);
    setVerifyCode('');
    setStep(STEP.ENROLLING);
  };

  // ── Verify: validate code + get backup codes ──────────────────────────────

  const handleVerify = async (e) => {
    e.preventDefault();
    clearError();
    if (!verifyCode.trim()) {
      setError('Enter the 6-digit code from your authenticator app');
      return;
    }
    setBusy(true);
    const { data, error: err } = await verifyTOTP(verifyCode.trim());
    setBusy(false);
    if (err) {
      setError(err.message || 'Invalid code — try again');
      return;
    }
    setBackupCodes(data.backup_codes);
    setStep(STEP.BACKUP_SHOWN);
  };

  // ── Disable 2FA ───────────────────────────────────────────────────────────

  const handleDisable = async (e) => {
    e.preventDefault();
    clearError();
    if (!disableCode.trim() && !disableBackup.trim()) {
      setError('Enter your TOTP code or a backup code to disable 2FA');
      return;
    }
    setBusy(true);
    const { error: err } = await disableTOTP({
      code: disableCode.trim() || undefined,
      backup_code: disableBackup.trim() || undefined,
    });
    setBusy(false);
    if (err) {
      setError(err.message || 'Failed to disable 2FA');
      return;
    }
    setDisableCode('');
    setDisableBackup('');
    loadStatus();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer className="max-w-2xl">
      {/* Page header */}
      <PageHeader
        eyebrow="Settings"
        title="Security"
        description="Manage your account security settings."
        icon={Shield}
      />

      {/* Error banner */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Two-factor authentication card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {step === STEP.ENABLED ? (
              <ShieldCheck className="h-5 w-5 text-beepbite-success" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
            Two-Factor Authentication
            {step === STEP.ENABLED && (
              <Badge className="bg-green-100 text-green-700 border-green-200 ml-1">
                Enabled
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Use an authenticator app (Google Authenticator, Authy, etc.) to
            generate time-based one-time passwords for an extra layer of security.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* ── LOADING ── */}
          {step === STEP.LOADING && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}

          {/* ── DISABLED: prompt to set up ── */}
          {step === STEP.DISABLED && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Two-factor authentication is not enabled on your account.
              </p>
              <Button onClick={handleEnroll} disabled={busy} className="gap-1.5">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Set up 2FA
              </Button>
            </div>
          )}

          {/* ── ENROLLING: show QR code ── */}
          {step === STEP.ENROLLING && (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  1. Scan this QR code with your authenticator app
                </p>
                <div className="inline-block p-3 bg-card rounded-lg border shadow-sm">
                  <QRCodeSVG value={otpauthURL} size={180} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Can't scan? Copy the URL manually:
                </p>
                <code className="block text-xs break-all bg-muted px-2 py-1.5 rounded select-all">
                  {otpauthURL}
                </code>
              </div>

              <Separator />

              <form onSubmit={handleVerify} className="space-y-3">
                <p className="text-sm font-medium">
                  2. Enter the 6-digit code from your app
                </p>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                    className="w-36 font-mono text-lg tracking-widest"
                    autoComplete="one-time-code"
                    required
                  />
                  <Button type="submit" disabled={busy || verifyCode.length !== 6}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => { setStep(STEP.DISABLED); clearError(); }}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* ── BACKUP CODES: show once ── */}
          {step === STEP.BACKUP_SHOWN && (
            <div className="space-y-4">
              <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40">
                <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-700 dark:text-green-300">
                  2FA is now enabled. Save these backup codes in a safe place —
                  they will not be shown again.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <p className="text-sm font-medium">Backup codes</p>
                <p className="text-xs text-muted-foreground">
                  Each code can be used once if you lose access to your
                  authenticator app.
                </p>
                <BackupCodes codes={backupCodes} />
              </div>

              <Button onClick={() => { setBackupCodes([]); loadStatus(); }}>
                I've saved my backup codes
              </Button>
            </div>
          )}

          {/* ── ENABLED: status + disable form ── */}
          {step === STEP.ENABLED && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  Two-factor authentication is active.{' '}
                  <span className="font-medium text-foreground">
                    {backupRemaining} backup code{backupRemaining !== 1 ? 's' : ''} remaining.
                  </span>
                </p>
              </div>

              {step === STEP.ENABLED && (
                <Button
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5"
                  onClick={() => { setStep(STEP.DISABLING); clearError(); }}
                >
                  <ShieldOff className="h-4 w-4" />
                  Disable 2FA
                </Button>
              )}
            </div>
          )}

          {/* ── DISABLING: confirmation form ── */}
          {step === STEP.DISABLING && (
            <form onSubmit={handleDisable} className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Disabling 2FA reduces your account security. Enter your
                  authenticator code or a backup code to confirm.
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="disable-code">Authenticator code</Label>
                  <Input
                    id="disable-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={disableCode}
                    onChange={(e) => {
                      setDisableCode(e.target.value.replace(/\D/g, ''));
                      setDisableBackup('');
                    }}
                    className="w-36 font-mono"
                    autoComplete="one-time-code"
                  />
                </div>

                <p className="text-xs text-muted-foreground">— or —</p>

                <div className="space-y-1.5">
                  <Label htmlFor="disable-backup">Backup code</Label>
                  <Input
                    id="disable-backup"
                    type="text"
                    placeholder="XXXX-XXXX"
                    value={disableBackup}
                    onChange={(e) => {
                      setDisableBackup(e.target.value.toUpperCase());
                      setDisableCode('');
                    }}
                    className="w-40 font-mono"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={busy || (!disableCode && !disableBackup)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Disable 2FA
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setStep(STEP.ENABLED); clearError(); }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
