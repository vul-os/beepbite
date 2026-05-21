// customer-search.jsx — POS customer lookup widget.
// Renders a debounced search input that queries GET /customers/search and
// shows matching customers as a card list. Clicking a customer fires
// onSelect(customer) so the parent can open detail or attach to an order.
/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, UserX } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { searchCustomers } from '@/services/customers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format last_order_date as a short human-readable string, or dash. */
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// CustomerSearch
// ---------------------------------------------------------------------------

/**
 * CustomerSearch — debounced customer lookup widget.
 *
 * Props:
 *   onSelect(customer) — called when the user clicks a result row.
 *                        customer shape: { id, name, phone, email,
 *                                         total_orders, last_order_date }
 *   placeholder        — input placeholder text (default: 'Search by name or phone…')
 *   limit              — max results (default: 20)
 *   className          — extra class on the root wrapper
 *   debounceMs         — debounce delay in ms (default: 300)
 */
export default function CustomerSearch({
  onSelect,
  placeholder = 'Search by name or phone…',
  limit = 20,
  className,
  debounceMs = 300,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const latestQueryRef = useRef('');

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: apiErr } = await searchCustomers(q.trim(), limit);
    // Ignore stale responses when the query has already changed.
    if (latestQueryRef.current !== q) return;
    setLoading(false);
    if (apiErr) {
      setError(apiErr.message || 'Search failed');
      setResults([]);
    } else {
      setResults(data?.customers ?? []);
    }
  }, [limit]);

  useEffect(() => {
    latestQueryRef.current = query;
    clearTimeout(timerRef.current);
    if (!query.trim()) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    timerRef.current = setTimeout(() => runSearch(query), debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [query, runSearch, debounceMs]);

  const handleSelect = (customer) => {
    if (typeof onSelect === 'function') onSelect(customer);
  };

  return (
    <div className={cn('flex flex-col gap-2 w-full', className)}>
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Results list */}
      {query.trim() && !loading && (
        <Card className="overflow-hidden divide-y divide-border">
          {error ? (
            <div className="px-4 py-3 text-sm text-destructive">{error}</div>
          ) : results.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <UserX className="h-4 w-4 shrink-0" />
              No customers found for <span className="font-medium">&ldquo;{query}&rdquo;</span>
            </div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c)}
                className="w-full text-left px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.phone}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">
                      {c.total_orders} {c.total_orders === 1 ? 'order' : 'orders'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last: {fmtDate(c.last_order_date)}
                    </p>
                  </div>
                </div>
                {c.email && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.email}</p>
                )}
              </button>
            ))
          )}
        </Card>
      )}
    </div>
  );
}
