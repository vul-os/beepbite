// table-card.jsx — one table tile on the floor canvas.
//
// In read-only mode (editable=false), a click triggers `onActivate(table)`.
// In editor mode (editable=true), wraps content with @dnd-kit's useDraggable
// so the consumer's DndContext can move it around.

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Users } from 'lucide-react';

const STATUS_STYLES = {
  available: 'bg-emerald-100 border-emerald-500 text-emerald-900',
  occupied:  'bg-rose-100 border-rose-500 text-rose-900',
  reserved:  'bg-amber-100 border-amber-500 text-amber-900',
  out_of_service: 'bg-zinc-200 border-zinc-400 text-zinc-600',
};

const STATUS_DOT = {
  available: 'bg-emerald-500',
  occupied:  'bg-rose-500',
  reserved:  'bg-amber-500',
  out_of_service: 'bg-zinc-400',
};

export const TABLE_WIDTH = 96;
export const TABLE_HEIGHT = 72;

function CardContent({ table, badge, busy }) {
  const status = table.status || 'available';
  return (
    <div
      className={cn(
        'h-full w-full rounded-md border-2 px-2 py-1.5 shadow-sm select-none',
        'flex flex-col justify-between',
        STATUS_STYLES[status] || STATUS_STYLES.available,
        busy && 'opacity-60'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm truncate">{table.label}</span>
        <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[status])} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {table.capacity}
        </span>
        {badge}
      </div>
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

  // Read-only mode: plain absolute-positioned tile with click handler.
  if (!editable) {
    return (
      <button
        type="button"
        onClick={() => onActivate && onActivate(table)}
        className="absolute focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400"
        style={{
          left: x,
          top: y,
          width: TABLE_WIDTH,
          height: TABLE_HEIGHT,
        }}
        aria-label={`Table ${table.label}`}
      >
        <CardContent table={table} badge={badge} busy={busy} />
      </button>
    );
  }

  // Editor mode: draggable.
  // The actual persistence lives on the parent's onDragEnd.
  return <DraggableTable table={table} x={x} y={y} badge={badge} busy={busy} />;
}

function DraggableTable({ table, x, y, badge, busy }) {
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
      className="absolute touch-none"
      {...listeners}
      {...attributes}
    >
      <CardContent table={table} badge={badge} busy={busy} />
    </div>
  );
}
