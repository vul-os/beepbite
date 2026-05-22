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
    <div className="flex-shrink-0 w-24 h-[4.5rem] rounded-xl border border-gray-200 bg-gray-100 animate-pulse" />
  )
}

function TableTile({ table, isActive, onSelect }) {
  const s = STATUS[table.status] ?? STATUS.available
  const disabled = table.status === "out_of_service"
  const subtotal = formatRands(table.subtotal_cents)
  const label = table.status === "occupied" ? "Occupied table" : table.status === "reserved" ? "Reserved table" : "Available table"

  return (
    <button
      disabled={disabled}
      onClick={() => !disabled && onSelect(table.id, "table")}
      aria-label={`${label}: ${table.label}${table.section_name ? ` in ${table.section_name}` : ''}${subtotal ? `, total ${subtotal}` : ''}`}
      aria-pressed={isActive}
      className={cn(
        "relative flex-shrink-0 w-24 h-[4.5rem] rounded-xl border-2 overflow-hidden",
        "flex flex-col items-center justify-center gap-0.5",
        "transition-all duration-150 select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1",
        s.bg,
        disabled
          ? "opacity-40 cursor-not-allowed border-gray-200"
          : cn("cursor-pointer hover:brightness-95", s.stripe.replace("bg-", "border-")),
        isActive
          ? "ring-2 ring-orange-500 ring-offset-1 scale-105 z-10 shadow-md border-orange-500"
          : !disabled && "border-transparent",
      )}
    >
      {/* Status stripe across the top */}
      <span className={cn("absolute top-0 left-0 right-0 h-1.5 rounded-t-xl", s.stripe)} />

      <span className={cn("font-bold text-sm leading-tight truncate max-w-[80px] px-1", s.text)}>
        {table.label}
      </span>

      {table.section_name && (
        <span className="text-[10px] text-gray-400 truncate max-w-[80px] px-1 leading-tight">
          {table.section_name}
        </span>
      )}

      {/* Occupied: show dot + subtotal */}
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
      aria-label={`Walk-in ticket: ${walkIn.label}${subtotal ? `, total ${subtotal}` : ''}`}
      aria-pressed={isActive}
      className={cn(
        "relative flex-shrink-0 w-24 h-[4.5rem] rounded-xl border-2 overflow-hidden",
        "flex flex-col items-center justify-center gap-0.5",
        "transition-all duration-150 select-none cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1",
        "bg-orange-50 hover:bg-orange-100",
        isActive
          ? "border-orange-500 ring-2 ring-orange-500 ring-offset-1 scale-105 z-10 shadow-md"
          : "border-orange-200",
      )}
    >
      <span className="absolute top-0 left-0 right-0 h-1.5 rounded-t-xl bg-orange-400" />

      <Users className="w-4 h-4 text-orange-500" />

      <span className="text-[11px] font-semibold text-orange-700 truncate max-w-[80px] px-1 leading-tight">
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
    <div className="w-full">
      <div
        role="tablist"
        aria-label="Tables and walk-in tickets"
        className="flex items-center gap-2 overflow-x-auto px-1 py-1 scrollbar-thin scrollbar-thumb-gray-200"
        style={{ scrollbarWidth: "thin" }}
      >
        {loading ? (
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
              aria-label="New walk-in tab"
              className={cn(
                "flex-shrink-0 w-24 h-[4.5rem] rounded-xl flex flex-col items-center justify-center gap-1",
                "border-dashed border-2 border-gray-300 text-gray-500",
                "hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50",
                "focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1",
                "transition-colors",
              )}
            >
              <Plus className="w-5 h-5" />
              <span className="text-[10px] leading-none font-medium">New tab</span>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
