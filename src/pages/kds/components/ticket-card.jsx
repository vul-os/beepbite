// ticket-card.jsx — one card in the per-station KDS grid.
//
// Rendered by src/pages/kds/station.jsx. The parent owns the ticket list and
// the bump/recall/refire/rush callbacks; this component is purely presentational
// except for elapsed-time formatting (which it derives from the shared 1Hz
// ticker so we don't run one interval per card) and the local
// "Recipe panel open?/checkbox checked?" state inside each <RecipeSection/>.
//
// The summary `ticket` prop carries the SSE/list payload (id, items, fired_at…).
// The optional `details` prop carries the GET /kds/tickets/{id}/details
// payload — ingredients, prep steps, variations, per-item status. The card
// gracefully renders without `details`; the parent fetches lazily and the
// recipe panel shows a quiet placeholder until the data lands.

/* eslint-disable react/prop-types */
import { useMemo } from 'react';
import {
  Bell, Check, Flame, Loader2, MapPin, RotateCcw, StickyNote, Utensils,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RecipeSection } from './recipe-section';

// Color thresholds (minutes since fired).
const AMBER_MIN = 5;
const RED_MIN = 10;

function ageBucket(elapsedMs) {
  const mins = elapsedMs / 60000;
  if (mins >= RED_MIN) return 'red';
  if (mins >= AMBER_MIN) return 'amber';
  return 'green';
}

function fmtElapsed(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '0:00';
  const totalSec = Math.floor(elapsedMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BORDER_BY_BUCKET = {
  green: 'border-emerald-500/60',
  amber: 'border-amber-500/70',
  red:   'border-red-600/80 ring-2 ring-red-600/40',
};

const HEADER_BY_BUCKET = {
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  red:   'bg-red-600/15 text-red-700 dark:text-red-300',
};

// Per-item color: gray (fired), amber (in_progress), green (ready). Falls
// back to neutral if the backend didn't supply per-item status.
const ITEM_STATUS_STYLES = {
  fired:       { dot: 'bg-zinc-400',    pill: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',     label: 'Fired'       },
  in_progress: { dot: 'bg-amber-500',   pill: 'bg-amber-500/20 text-amber-800 dark:text-amber-200',  label: 'In progress' },
  ready:       { dot: 'bg-emerald-500', pill: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300', label: 'Ready'   },
};

export function TicketCard({
  ticket,
  details,            // optional; from GET /kds/tickets/{id}/details
  detailsLoading,     // optional bool
  now,
  onBump,
  onRecall,
  onRefire,
  onRush,
  showRecall = false,
  busy = false,
}) {
  const firedAtMs = ticket.fired_at
    ? Date.parse(ticket.fired_at)
    : (details?.fired_at ? Date.parse(details.fired_at) : Date.now());
  const elapsed = Math.max(0, now - firedAtMs);
  const bucket = ageBucket(elapsed);

  const isBumped = ticket.status === 'bumped';
  const label = ticket.order_type
    || (ticket.table_number ? `Table ${ticket.table_number}` : null)
    || (details?.table_number ? `Table ${details.table_number}` : null)
    || 'Order';

  // Prefer the detailed item list when we have it (carries variations,
  // ingredients, prep_steps, notes, per-item status). Otherwise fall back
  // to the summary list from the SSE feed.
  const items = useMemo(() => {
    const fromDetails = Array.isArray(details?.items) ? details.items : null;
    if (fromDetails && fromDetails.length) return fromDetails;
    return Array.isArray(ticket.items) ? ticket.items : [];
  }, [details, ticket.items]);

  // Default the recipe panel open while the ticket is freshly fired and
  // collapse it once it transitions to in_progress on the backend. Local
  // "user ticked a step" wins inside RecipeSection itself.
  const recipeDefaultOpen = ticket.status !== 'in_progress';

  const orderNumber = ticket.ticket_number
    ?? details?.order_number
    ?? ticket.order_number
    ?? '—';
  const tableNumber = ticket.table_number || details?.table_number || null;

  return (
    <Card
      className={cn(
        'group flex flex-col overflow-hidden text-base shadow-md transition-all',
        'animate-in fade-in-50 slide-in-from-bottom-2 duration-300',
        BORDER_BY_BUCKET[bucket],
      )}
    >
      <CardHeader className={cn('flex flex-row items-center justify-between gap-3 p-4', HEADER_BY_BUCKET[bucket])}>
        <div className="flex min-w-0 items-baseline gap-3">
          <Flame className="size-5 shrink-0" />
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-3xl font-extrabold tabular-nums">
              #{orderNumber}
            </span>
            <span className="flex items-center gap-1 text-sm opacity-80">
              {tableNumber && <MapPin className="size-3.5" />}
              {tableNumber ? `Table ${tableNumber}` : label}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-2xl font-bold tabular-nums">
            {fmtElapsed(elapsed)}
          </span>
          <div className="flex items-center gap-1">
            {detailsLoading && (
              <Loader2 className="size-3 animate-spin opacity-60" />
            )}
            {ticket.priority > 0 && (
              <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[0.7rem]">
                <Bell className="size-3" /> Rush
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {items.length === 0 ? (
          <p className="italic text-muted-foreground">(no items)</p>
        ) : (
          <ul className="flex-1 space-y-3">
            {items.map((it, idx) => (
              <TicketItem
                key={it.ticket_item_id || it.id || `${it.item_name || it.name}-${idx}`}
                item={it}
                recipeDefaultOpen={recipeDefaultOpen}
                storageKey={`${ticket.id}-${it.ticket_item_id || it.id || idx}`}
              />
            ))}
          </ul>
        )}

        {ticket.notes && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm italic text-amber-800 dark:text-amber-200">
            <StickyNote className="mr-1 inline size-3.5 align-text-bottom" />
            {ticket.notes}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {!isBumped && (
            <>
              <Button
                size="lg"
                className="h-12 flex-1 min-w-[10rem] text-base font-semibold"
                disabled={busy}
                onClick={() => onBump?.(ticket)}
              >
                <Check className="size-5" /> Mark Ready
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12"
                disabled={busy || ticket.priority > 0}
                onClick={() => onRush?.(ticket)}
                title="Mark as rush"
              >
                <Bell className="size-5" /> Rush
              </Button>
            </>
          )}
          {isBumped && (
            <Button
              size="lg"
              variant="secondary"
              className="h-12 flex-1 text-base font-semibold"
              disabled={busy}
              onClick={() => onRefire?.(ticket)}
            >
              <RotateCcw className="size-5" /> Refire
            </Button>
          )}
          {showRecall && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onRecall?.(ticket)}
              title="Recall last bump"
            >
              <RotateCcw className="size-4" /> Recall
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// One row in the ticket: name, qty, variations, notes, optional recipe panel.
function TicketItem({ item, recipeDefaultOpen, storageKey }) {
  const name = item.item_name || item.name || 'Item';
  const qty = Number(item.quantity ?? 1);
  const variations = Array.isArray(item.variations) ? item.variations : [];
  const statusKey = item.status || item.item_status || null;
  const status = ITEM_STATUS_STYLES[statusKey] || null;

  return (
    <li className="space-y-2 rounded-lg border bg-card/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {status && (
            <span
              className={cn('inline-block size-2.5 shrink-0 rounded-full', status.dot)}
              title={status.label}
              aria-label={status.label}
            />
          )}
          <Utensils className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-lg font-bold leading-tight">{name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <span className={cn('rounded-full px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide', status.pill)}>
              {status.label}
            </span>
          )}
          <span className="rounded-md bg-primary/10 px-2.5 py-0.5 font-mono text-base font-bold tabular-nums text-primary">
            ×{qty}
          </span>
        </div>
      </div>

      {variations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {variations.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {v}
            </span>
          ))}
        </div>
      )}

      {item.notes && (
        <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-sm italic text-amber-800 dark:text-amber-200">
          <StickyNote className="mr-1 inline size-3.5 align-text-bottom" />
          {item.notes}
        </p>
      )}

      <RecipeSection
        item={item}
        defaultOpen={recipeDefaultOpen}
        storageKey={storageKey}
      />
    </li>
  );
}

export default TicketCard;
