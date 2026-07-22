// sync-status.jsx — the app's one shared "are we talking to the server"
// indicator.
//
// README: BeepBite is "progressing toward full offline" and the offline
// mutation queue (src/offline/queue.js) already persists failed writes to
// IndexedDB and replays them on reconnect — but nothing in the UI ever told
// anyone that was happening. A cashier mid-rush whose card-machine internet
// blips would see requests silently succeed-looking (optimistic UI) with no
// signal that they were actually queued, not sent. That's the opposite of
// "first-class": it's invisible.
//
// useSyncStatus() polls the real queue (getPendingCount, onFlush) and the
// browser's online/offline events and reduces them to four states:
//   'ok'      — online, nothing queued
//   'offline' — navigator.onLine is false
//   'syncing' — online, but mutations are still queued (draining)
//   'error'   — reserved for a future "queue exhausted a mutation" surface;
//               not wired to anything today, kept so call sites don't need
//               to change shape when that lands.
//
// <SyncStatusBadge/> is the compact top-bar/chrome pill. <OfflineBanner/> is
// a full-width strip for chrome-less screens (POS workspace, KDS, quick POS)
// where there is no top bar to host the badge and the state needs to be
// impossible to miss.
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff, RefreshCw, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPendingCount, onFlush } from '@/offline/queue';

export function useSyncStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [pending, setPending] = useState(0);

  const refresh = useCallback(() => {
    getPendingCount().then(setPending).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsubFlush = onFlush(() => refresh());
    // Belt-and-braces: the queue can gain items from anywhere in the app
    // (any enqueueMutation call), so poll at a slow, battery-friendly
    // interval too rather than requiring every caller to notify us.
    const interval = setInterval(refresh, 4000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsubFlush();
      clearInterval(interval);
    };
  }, [refresh]);

  const status = !online ? 'offline' : pending > 0 ? 'syncing' : 'ok';
  return { status, online, pending, refresh };
}

/** Compact pill — top bar, settings header, anywhere with room for one line. */
export function SyncStatusBadge({ className }) {
  const { t } = useTranslation();
  const { status, pending } = useSyncStatus();

  if (status === 'ok') {
    return (
      <span
        className={cn('sync-pill-ok inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold', className)}
        title={t('sync.synced')}
      >
        <CircleCheck className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{t('sync.synced')}</span>
      </span>
    );
  }

  if (status === 'offline') {
    return (
      <span
        role="status"
        className={cn('sync-pill-offline inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold', className)}
      >
        <CloudOff className="size-3.5" aria-hidden="true" />
        <span>{t('sync.offline')}</span>
        {pending > 0 && <span className="tabular-nums">· {t('sync.queued', { count: pending })}</span>}
      </span>
    );
  }

  // syncing
  return (
    <span
      role="status"
      className={cn('sync-pill-syncing inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold', className)}
    >
      <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span className="tabular-nums">{t('sync.queued', { count: pending })}</span>
    </span>
  );
}

/**
 * Full-width strip for chrome-less kiosk/KDS/POS screens, which have no top
 * bar to host the badge above. Renders nothing when fully synced — it only
 * needs to interrupt when there's something to know. `dark` renders the
 * on-charcoal palette used by the KDS/POS-till chrome instead of the default
 * light-surface tokens.
 */
export function OfflineBanner({ dark = false, className }) {
  const { t } = useTranslation();
  const { status, pending } = useSyncStatus();

  if (status === 'ok') return null;

  const isOffline = status === 'offline';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex shrink-0 items-center justify-center gap-2.5 px-4 py-2 text-sm font-semibold',
        isOffline
          ? 'bg-warning text-warning-foreground'
          : dark
            ? 'bg-gray-800 text-gray-200'
            : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {isOffline ? (
        <CloudOff className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <RefreshCw className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      )}
      <span>{isOffline ? t('sync.offline') : t('sync.syncing')}</span>
      {pending > 0 && (
        <span className="tabular-nums opacity-90">— {t('sync.queued', { count: pending })}</span>
      )}
    </div>
  );
}

export default SyncStatusBadge;
