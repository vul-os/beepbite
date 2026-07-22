import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { AlertCircle, Download, Trash2, RotateCcw, Loader2, UserCog } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDateTime } from '@/context/locale-context';
import { deleteAccount, restoreAccount, requestDataExport } from '@/services/datarights';

// ---------------------------------------------------------------------------
// AccountSettings — Wave 31 data-rights page
//
// Capabilities surfaced:
//   • Delete account  — soft-delete with 30-day grace / cancel window
//   • Restore account — cancel a pending soft-delete
//   • Export data     — download a full JSON archive
// ---------------------------------------------------------------------------

const AccountSettings = () => {
  const { activeOrganization } = useAuth();
  const { today } = useDateTime();
  const isDeleted = Boolean(activeOrganization?.deleted_at);

  const [deleteState, setDeleteState]   = useState('idle');   // idle | confirm | loading | done
  const [restoreState, setRestoreState] = useState('idle');   // idle | loading | done
  const [exportState, setExportState]   = useState('idle');   // idle | loading | done | error
  const [exportError, setExportError]   = useState('');
  const [deleteError, setDeleteError]   = useState('');
  const [restoreError, setRestoreError] = useState('');

  // ── Delete account ─────────────────────────────────────────────────────────
  const handleDeleteRequest = () => setDeleteState('confirm');
  const handleDeleteCancel  = () => setDeleteState('idle');

  const handleDeleteConfirm = async () => {
    setDeleteState('loading');
    setDeleteError('');
    const { error } = await deleteAccount();
    if (error) {
      setDeleteError(error.message ?? 'An error occurred. Please try again.');
      setDeleteState('confirm');
      return;
    }
    setDeleteState('done');
  };

  // ── Restore account ────────────────────────────────────────────────────────
  const handleRestore = async () => {
    setRestoreState('loading');
    setRestoreError('');
    const { error } = await restoreAccount();
    if (error) {
      setRestoreError(error.message ?? 'An error occurred. Please try again.');
      setRestoreState('idle');
      return;
    }
    setRestoreState('done');
  };

  // ── Export data ────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExportState('loading');
    setExportError('');
    const { data, error } = await requestDataExport();
    if (error) {
      setExportError(error.message ?? 'Export failed. Please try again.');
      setExportState('error');
      return;
    }
    // Trigger browser download of the archive JSON.
    const blob = new Blob([JSON.stringify(data?.archive ?? data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    // The store's local trading date, not `new Date().toISOString().slice(0, 10)`
    // (the UTC date — wrong for most of the day in most timezones).
    a.download = `beepbite-export-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportState('done');
  };

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        eyebrow="Settings"
        title="Account & Data"
        description="Manage your account, export your data, or request deletion."
        icon={UserCog}
      />

      {/* ── Restore notice (shown when org is soft-deleted) ── */}
      {(isDeleted || restoreState === 'done' || deleteState === 'done') && (
        <Card className="border-warning/40 bg-warning/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertCircle className="h-5 w-5" />
              Account scheduled for deletion
            </CardTitle>
            <CardDescription className="text-warning">
              Your account will be permanently deleted when the 30-day grace period
              expires. You can cancel the deletion below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {restoreState === 'done' ? (
              <p className="text-success font-medium">
                Deletion cancelled — your account is active again.
              </p>
            ) : (
              <>
                {restoreError && (
                  <p className="text-destructive text-sm mb-3">{restoreError}</p>
                )}
                <Button
                  variant="outline"
                  className="border-warning/60 text-warning hover:bg-warning/10"
                  onClick={handleRestore}
                  disabled={restoreState === 'loading'}
                >
                  {restoreState === 'loading' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Cancel deletion &amp; restore account
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Export data ── */}
      <Card>
        <CardHeader>
          <CardTitle>Export your data</CardTitle>
          <CardDescription>
            Download a JSON archive of your organisation&apos;s orders, customers,
            staff, and audit log (last 90 days).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportError && (
            <p className="text-destructive text-sm">{exportError}</p>
          )}
          {exportState === 'done' && (
            <p className="text-success text-sm font-medium">
              Export downloaded successfully.
            </p>
          )}
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportState === 'loading'}
          >
            {exportState === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {exportState === 'loading' ? 'Building archive…' : 'Export data'}
          </Button>
        </CardContent>
      </Card>

      {/* ── Delete account ── */}
      {!isDeleted && deleteState !== 'done' && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Delete account</CardTitle>
            <CardDescription>
              Permanently removes your organisation and all associated data after a
              30-day grace period. This action can be reversed within 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deleteError && (
              <p className="text-destructive text-sm">{deleteError}</p>
            )}

            {deleteState !== 'confirm' ? (
              <Button
                variant="destructive"
                onClick={handleDeleteRequest}
                disabled={deleteState === 'loading'}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete account
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-destructive font-medium">
                  Are you sure? Your account will be scheduled for permanent
                  deletion in 30 days.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    onClick={handleDeleteConfirm}
                    disabled={deleteState === 'loading'}
                  >
                    {deleteState === 'loading' ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Yes, delete my account
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDeleteCancel}
                    disabled={deleteState === 'loading'}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
};

export default AccountSettings;
