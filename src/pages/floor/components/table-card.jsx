// table-card.jsx — one table tile on the floor canvas.
//
// In read-only mode (editable=false), a click triggers `onActivate(table)`.
// In editor mode (editable=true), wraps content with @dnd-kit's useDraggable
// so the consumer's DndContext can move it around.
//
// Status is never colour-only. A floor manager scanning a busy room at a
// glance (and a colour-blind one specifically — deuteranopia/protanopia make
// the classic red=stop/green=go pairing indistinguishable) gets three
// redundant signals per tile:
//   1. a distinct ICON in the status roundel (not just a recoloured dot)
//   2. a visible text LABEL (not just a tinted background)
//   3. a border PATTERN — solid for the three "live" seating states,
//      dashed for out-of-service — so even a low-vision glance at shape
//      alone tells "in rotation" from "not usable right now".

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, CheckCircle2, Loader2, Users, UtensilsCrossed, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

// Four statuses the backend actually models (see backend/cmd/seedcopper and
// use-tables.js) — there is no separate "needs_cleaning" enum value; a table
// coming out of service covers both "broken" and "needs a wipe-down before
// the next seating", so the label and icon below are written to read
// naturally for either.
const STATUS_META = {
  available: {
    label: 'Available',
    icon: CheckCircle2,
    roundel: 'bg-success text-success-foreground',
    tile: 'bg-success/10 border-success/50 text-success',
    border: 'border-solid',
  },
  occupied: {
    label: 'Occupied',
    icon: UtensilsCrossed,
    roundel: 'bg-primary text-primary-foreground',
    tile: 'bg-primary/10 border-primary/50 text-primary',
    border: 'border-solid',
  },
  reserved: {
    label: 'Reserved',
    icon: CalendarClock,
    roundel: 'bg-warning text-warning-foreground',
    tile: 'bg-warning/10 border-warning/50 text-warning',
    border: 'border-solid',
  },
  out_of_service: {
    label: 'Out of service',
    icon: Wrench,
    roundel: 'bg-muted-foreground text-background',
    tile: 'bg-muted border-border text-muted-foreground',
    // Dashed, not solid — a shape difference so this state never reads as
    // "just another colour" of the three seatable ones above.
    border: 'border-dashed',
  },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.available;
}

export const TABLE_WIDTH = 96;
export const TABLE_HEIGHT = 72;

function CardContent({ table, badge, busy }) {
  const status = table.status || 'available';
  const meta = statusMeta(status);
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        'relative h-full w-full rounded-md border-2 px-2 py-1.5 shadow-sm select-none',
        'flex flex-col justify-between',
        meta.tile,
        meta.border,
        busy && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-display font-extrabold text-sm leading-tight truncate">{table.label}</span>
        {/* Status roundel: icon + colour, never colour alone */}
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            meta.roundel,
          )}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
        </span>
      </div>

      <div className="flex items-end justify-between gap-1">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Users className="h-3 w-3" aria-hidden="true" />
          {table.capacity}
        </span>
        {badge}
      </div>

      {/* Visible status word — the third, non-colour signal */}
      <span className="absolute bottom-1.5 left-2 text-[8px] font-bold uppercase tracking-wide leading-none pointer-events-none">
        {meta.label}
      </span>

      {busy && (
        <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/40">
          <Loader2 className="h-4 w-4 animate-spin text-foreground" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

export default function TableCard({
  table,
  editable = false,
  onActivate,
  badge = null,
  busy = false,
}) {
  const x = Number(table.pos_x) || 0;
  const y = Number(table.pos_y) || 0;
  const status = table.status || 'available';
  const meta = statusMeta(status);

  // Read-only mode: plain absolute-positioned tile with click handler.
  if (!editable) {
    return (
      <button
        type="button"
        onClick={() => onActivate && onActivate(table)}
        disabled={busy}
        className="absolute focus-ring-strong disabled:cursor-wait"
        style={{
          left: x,
          top: y,
          width: TABLE_WIDTH,
          height: TABLE_HEIGHT,
        }}
        aria-label={`Table ${table.label}, ${meta.label}, seats ${table.capacity}`}
      >
        <CardContent table={table} badge={badge} busy={busy} />
      </button>
    );
  }

  // Editor mode: draggable.
  // The actual persistence lives on the parent's onDragEnd.
  return <DraggableTable table={table} x={x} y={y} badge={badge} busy={busy} meta={meta} />;
}

function DraggableTable({ table, x, y, badge, busy, meta }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: table.id, data: { table } });

  const style = {
    left: x,
    top: y,
    width: TABLE_WIDTH,
    height: TABLE_HEIGHT,
    transform: CSS.Translate.toString(transform),
    cursor: isDragging ? 'grabbing' : 'grab',
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="absolute touch-none focus-ring-strong"
      role="button"
      tabIndex={0}
      aria-label={`Table ${table.label}, ${meta.label}, seats ${table.capacity}. Drag to reposition.`}
      {...listeners}
      {...attributes}
    >
      <CardContent table={table} badge={badge} busy={busy} />
    </div>
  );
}
