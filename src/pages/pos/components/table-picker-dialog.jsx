import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Search, Users, Loader2, CheckCircle2, MapPin } from "lucide-react"

// Visual tokens — mirrors tables-strip.jsx STATUS map
const STATUS = {
  available:      { outline: "border-emerald-400", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  occupied:       { outline: "border-red-400",    bg: "bg-red-50",     text: "text-red-700",    dot: "bg-red-400"    },
  reserved:       { outline: "border-amber-400",  bg: "bg-amber-50",   text: "text-amber-700",  dot: "bg-amber-400"  },
  out_of_service: { outline: "border-gray-200",   bg: "bg-gray-100",   text: "text-gray-400",   dot: "bg-gray-300"   },
}

const STATUS_FILTERS = ["All", "Available only", "Including reserved"]

function SkeletonTile() {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-100 animate-pulse h-24" />
  )
}

function TableTile({ table, onSelect, onOpenChange, statusFilter }) {
  const s = STATUS[table.status] ?? STATUS.available
  const isOccupied = table.status === "occupied"
  const isReserved = table.status === "reserved"
  const isAvailable = table.status === "available"

  const disabled =
    isOccupied ||
    (isReserved && statusFilter !== "Including reserved")

  function handleClick() {
    if (disabled) return
    onSelect(table)
    onOpenChange(false)
  }

  return (
    <button
      disabled={disabled}
      onClick={handleClick}
      title={isOccupied ? "Already has an open tab" : undefined}
      className={cn(
        "group relative rounded-xl border-2 p-3 flex flex-col gap-1.5",
        "transition-all duration-150 select-none text-left",
        s.bg,
        s.outline,
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:brightness-95 hover:shadow-md hover:scale-[1.02]",
        isAvailable && "hover:border-orange-400",
      )}
    >
      {/* Status dot */}
      <span className={cn("absolute top-2 right-2 w-2 h-2 rounded-full", s.dot)} />

      {/* Table label */}
      <span className={cn("font-bold text-lg leading-none", s.text)}>
        {table.label}
      </span>

      {/* Section */}
      {table.section_name && (
        <span className="flex items-center gap-0.5 text-[11px] text-gray-500 leading-tight truncate">
          <MapPin className="w-2.5 h-2.5 shrink-0" />
          {table.section_name}
        </span>
      )}

      {/* Capacity */}
      {table.capacity != null && (
        <span className="flex items-center gap-0.5 text-[11px] text-gray-500 leading-tight">
          <Users className="w-2.5 h-2.5 shrink-0" />
          {table.capacity}
        </span>
      )}

      {/* Hover affordance for available */}
      {!disabled && (
        <span className="absolute inset-0 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-orange-500/10">
          <CheckCircle2 className="w-6 h-6 text-orange-500 drop-shadow" />
        </span>
      )}

      {/* Occupied note shown inline below */}
      {isOccupied && (
        <span className="text-[10px] text-red-500 font-medium leading-tight mt-auto">
          Open tab
        </span>
      )}
    </button>
  )
}

export function TablePickerDialog({
  open,
  onOpenChange,
  tables = [],
  sections = [],
  loading = false,
  onSelect,
}) {
  const [query, setQuery] = useState("")
  const [sectionFilter, setSectionFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("Available only")

  // Reset filters when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("")
      setSectionFilter("all")
      setStatusFilter("Available only")
    }
  }, [open])

  const visibleTables = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tables.filter((t) => {
      // Hide out-of-service always
      if (t.status === "out_of_service") return false

      // Status filter
      if (statusFilter === "Available only" && t.status !== "available") return false
      if (statusFilter === "Including reserved" && t.status === "occupied") return false

      // Section filter
      if (sectionFilter !== "all" && t.section_id !== sectionFilter) return false

      // Text search
      if (q) {
        const num = String(t.label ?? '').toLowerCase()
        const sec = (t.section_name ?? "").toLowerCase()
        if (!num.includes(q) && !sec.includes(q)) return false
      }

      return true
    })
  }, [tables, query, sectionFilter, statusFilter])

  // Derive sections from tables if not explicitly passed
  const derivedSections = useMemo(() => {
    if (sections.length > 0) return sections
    const seen = new Map()
    for (const t of tables) {
      if (t.section_id && t.section_name && !seen.has(t.section_id)) {
        seen.set(t.section_id, { id: t.section_id, name: t.section_name })
      }
    }
    return Array.from(seen.values())
  }, [sections, tables])

  function resetFilters() {
    setQuery("")
    setSectionFilter("all")
    setStatusFilter("Available only")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="text-lg font-semibold">Assign to a Table</DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Pick an available table for this ticket.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-5 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Search by table or section…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Section chips */}
        {derivedSections.length > 0 && (
          <div className="px-5 pb-2 flex items-center gap-1.5 flex-wrap shrink-0">
            {[{ id: "all", name: "All sections" }, ...derivedSections].map((sec) => (
              <button
                key={sec.id}
                onClick={() => setSectionFilter(sec.id)}
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors",
                  sectionFilter === sec.id
                    ? "bg-orange-500 border-orange-500 text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600",
                )}
              >
                {sec.name}
              </button>
            ))}
          </div>
        )}

        {/* Status filter chips */}
        <div className="px-5 pb-3 flex items-center gap-1.5 shrink-0">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors",
                statusFilter === f
                  ? "bg-orange-500 border-orange-500 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100 shrink-0" />

        {/* Table grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonTile key={i} />
              ))}
            </div>
          ) : visibleTables.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400">
              <Search className="w-8 h-8 opacity-40" />
              <p className="text-sm font-medium">No tables match</p>
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {visibleTables.map((table) => (
                <TableTile
                  key={table.id}
                  table={table}
                  onSelect={onSelect}
                  onOpenChange={onOpenChange}
                  statusFilter={statusFilter}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between shrink-0">
          {loading ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading tables…
            </span>
          ) : (
            <span className="text-xs text-gray-400">
              {visibleTables.length} table{visibleTables.length !== 1 ? "s" : ""}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
