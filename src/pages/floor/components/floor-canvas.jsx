// floor-canvas.jsx — the 2D floor surface that holds absolutely-positioned
// TableCard tiles. In editable mode it wires up a DndContext + pointer sensor
// and forwards drag results upward via `onDragPersist(table, {pos_x, pos_y})`.
//
// Snap-to-grid: positions are rounded to the nearest GRID_PX (16px) before
// emitting onDragPersist.

import { useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import TableCard, { TABLE_WIDTH, TABLE_HEIGHT } from './table-card';

const GRID_PX = 16;
const CANVAS_W = 1200;
const CANVAS_H = 720;

function snap(n) {
  return Math.max(0, Math.round(n / GRID_PX) * GRID_PX);
}

function GridBackground() {
  return (
    <svg
      className="absolute inset-0 pointer-events-none opacity-60"
      width={CANVAS_W}
      height={CANVAS_H}
      aria-hidden="true"
    >
      <defs>
        <pattern id="floor-grid" width={GRID_PX} height={GRID_PX} patternUnits="userSpaceOnUse">
          <path
            d={`M ${GRID_PX} 0 L 0 0 0 ${GRID_PX}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width={CANVAS_W} height={CANVAS_H} fill="url(#floor-grid)" />
    </svg>
  );
}

export default function FloorCanvas({
  tables = [],
  editable = false,
  onActivate,
  onDragPersist,
  renderBadge,
  busyIds = new Set(),
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const canvasRef = useRef(null);

  const handleDragEnd = (event) => {
    if (!editable || !onDragPersist) return;
    const { active, delta } = event;
    const tbl = active?.data?.current?.table;
    if (!tbl) return;
    const x = snap(Number(tbl.pos_x || 0) + delta.x);
    const y = snap(Number(tbl.pos_y || 0) + delta.y);
    // Clamp inside canvas so a dragged table doesn't end up off-screen.
    const cx = Math.min(x, Math.max(0, CANVAS_W - TABLE_WIDTH));
    const cy = Math.min(y, Math.max(0, CANVAS_H - TABLE_HEIGHT));
    onDragPersist(tbl, { pos_x: cx, pos_y: cy });
  };

  const surface = (
    <div
      ref={canvasRef}
      className="relative bg-card rounded-lg border-2 border-border overflow-hidden"
      style={{ width: CANVAS_W, height: CANVAS_H }}
    >
      <GridBackground />
      {tables.map((t) => (
        <TableCard
          key={t.id}
          table={t}
          editable={editable}
          onActivate={onActivate}
          busy={busyIds.has(t.id)}
          badge={renderBadge ? renderBadge(t) : null}
        />
      ))}
    </div>
  );

  if (!editable) return <div className="overflow-auto">{surface}</div>;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="overflow-auto">{surface}</div>
    </DndContext>
  );
}

export { GRID_PX, CANVAS_W, CANVAS_H };
