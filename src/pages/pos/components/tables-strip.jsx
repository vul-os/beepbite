import { Plus, Users, Circle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function formatRands(cents) {
  if (!cents) return null
  return `R ${(cents / 100).toFixed(2)}`
}

// Maps table status to visual tokens
const STATUS = {
  available:       { stripe: "bg-green-500",  bg: "bg-green-50",   text: "text-green-700",  dot: "text-green-500"  },
  occupied:        { stripe: "bg-red-400",    bg: "bg-red-50",     text: "text-red-700",    dot: "text-red-400"    },
  reserved:        { stripe: "bg-slate-400",  bg: "bg-slate-50",   text: "text-slate-600",  dot: "text-slate-400"  },
  out_of_service:  { stripe: "bg-gray-300",   bg: "bg-gray-100",   text: "text-gray-400",   dot: "text-gray-300"   },
}

function SkeletonTile() {
  return (
    <div className="flex-shrink-0 w-20 h-16 rounded-xl border border-gray-200 bg-gray-100 animate-pulse" />
  )
}

function TableTile({ table, isActive, onSelect }) {
  const s = STATUS[table.status] ?? STATUS.available
  const disabled = table.status === "out_of_service"
  const subtotal = formatRands(table.subtotal_cents)

  return (
    <button
      disabled={disabled}
      onClick={() => !disabled && onSelect(table.id, "table")}
      className={cn(
        "relative flex-shrink-0 w-20 h-16 rounded-xl border overflow-hidden",
        "flex flex-col items-center justify-center gap-0.5",
        "transition-all duration-150 select-none",
        s.bg,
        disabled
          ? "opacity-40 cursor-not-allowed"
          : "cursor-pointer hover:brightness-95",
        isActive && "ring-2 ring-orange-500 scale-105 z-10 shadow-md",
      )}
    >
      {/* Status stripe across the top */}
      <span className={cn("absolute top-0 left-0 right-0 h-1 rounded-t-xl", s.stripe)} />

      <span className={cn("font-semibold text-sm leading-tight truncate max-w-[68px] px-1", s.text)}>
        {table.label}
      </span>

      {table.section_name && (
        <span className="text-[10px] text-gray-400 truncate max-w-[68px] px-1 leading-tight">
          {table.section_name}
        </span>
      )}

      {/* Occupied: show dot + subtotal + item count */}
      {table.status === "occupied" && (
        <div className="flex items-center gap-0.5 mt-0.5">
          <Circle className="w-2 h-2 fill-red-400 text-red-400" />
          {subtotal && (
            <span className="text-[9px] tabular-nums text-red-600 font-medium leading-none">
              {subtotal}
            </span>
          )}
          {table.guest_count > 0 && (
            <span className="ml-0.5 text-[9px] bg-red-400 text-white rounded-full px-1 leading-tight">
              {table.guest_count}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

function WalkInTile({ walkIn, isActive, onSelect }) {
  const subtotal = formatRands(walkIn.subtotal_cents)

  return (
    <button
      onClick={() => onSelect(walkIn.id, "walkin")}
      className={cn(
        "relative flex-shrink-0 w-20 h-16 rounded-xl border overflow-hidden",
        "flex flex-col items-center justify-center gap-0.5",
        "transition-all duration-150 select-none cursor-pointer",
        "bg-orange-50 border-orange-200 hover:brightness-95",
        isActive && "ring-2 ring-orange-500 scale-105 z-10 shadow-md",
      )}
    >
      <span className="absolute top-0 left-0 right-0 h-1 rounded-t-xl bg-orange-400" />

      <Users className="w-4 h-4 text-orange-500" />

      <span className="text-[11px] font-semibold text-orange-700 truncate max-w-[68px] px-1 leading-tight">
        {walkIn.label}
      </span>

      {(subtotal || walkIn.item_count > 0) && (
        <div className="flex items-center gap-0.5">
          {subtotal && (
            <span className="text-[9px] tabular-nums text-orange-600 font-medium leading-none">
              {subtotal}
            </span>
          )}
          {walkIn.item_count > 0 && (
            <span className="text-[9px] bg-orange-400 text-white rounded-full px-1 leading-tight">
              {walkIn.item_count}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

export function TablesStrip({
  tables = [],
  walkIns = [],
  activeTicketId = null,
  onSelect,
  onAddWalkIn,
  loading = false,
}) {
  return (
    <div className="w-full border-b border-gray-200 bg-white">
      <div
        className="flex items-center gap-2 overflow-x-auto px-3 py-2 scrollbar-thin scrollbar-thumb-gray-200"
        style={{ scrollbarWidth: "thin" }}
      >
        {loading ? (
          // 6 skeleton tiles while data loads
          Array.from({ length: 6 }).map((_, i) => <SkeletonTile key={i} />)
        ) : (
          <>
            {tables.map((table) => (
              <TableTile
                key={table.id}
                table={table}
                isActive={activeTicketId === table.id}
                onSelect={onSelect}
              />
            ))}

            {walkIns.map((w) => (
              <WalkInTile
                key={w.id}
                walkIn={w}
                isActive={activeTicketId === w.id}
                onSelect={onSelect}
              />
            ))}

            {/* Add walk-in button — always visible at the end */}
            <Button
              variant="outline"
              onClick={onAddWalkIn}
              className={cn(
                "flex-shrink-0 w-20 h-16 rounded-xl flex flex-col items-center justify-center gap-1",
                "border-dashed border-gray-300 text-gray-500 hover:border-orange-400 hover:text-orange-500",
                "transition-colors",
              )}
            >
              <Plus className="w-4 h-4" />
              <span className="text-[10px] leading-none">New tab</span>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
