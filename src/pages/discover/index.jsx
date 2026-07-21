import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { getStores } from '@/services/marketplace';
import StoreCard from './components/store-card';

const CITIES = ['All cities', 'Cape Town', 'Johannesburg', 'Durban', 'Pretoria', 'Port Elizabeth'];
const DISTANCES = [
  { label: 'Any distance', value: '' },
  { label: 'Within 2 km', value: '2' },
  { label: 'Within 5 km', value: '5' },
  { label: 'Within 10 km', value: '10' },
  { label: 'Within 25 km', value: '25' },
];

function StoreSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-border/60 bg-card shadow-sm">
      <Skeleton className="h-40 sm:h-48 w-full rounded-none" />
      <div className="p-3 sm:p-4 space-y-2.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-5 w-14 rounded-md" />
          <Skeleton className="h-5 w-12 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [distance, setDistance] = useState('');
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  // Debounced search ref
  const debounceTimer = useRef(null);

  const fetchStores = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await getStores(params);
      if (err) throw new Error(err.message || 'Failed to load stores');
      // API may return { stores: [...] } or a plain array
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.stores)
          ? data.stores
          : [];
      setStores(list);
    } catch (e) {
      setError(e.message);
      // Fall back to empty demo list so the UI is still usable during dev
      setStores([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + re-fetch when filters change
  useEffect(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchStores({
        query: query.trim() || undefined,
        city: city || undefined,
        distance: distance ? Number(distance) : undefined,
      });
    }, 350);
    return () => clearTimeout(debounceTimer.current);
  }, [query, city, distance, fetchStores]);

  const clearSearch = () => {
    setQuery('');
    setCity('');
    setDistance('');
  };

  const hasFilters = query || city || distance;

  return (
    <div className="min-h-screen bg-background">
      {/* Hero / search bar */}
      <div className="bg-gradient-to-br from-orange-500 via-orange-500 to-orange-600 px-4 pt-10 pb-8 sm:pt-14 sm:pb-10">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow-sm">
            Find food near you
          </h1>
          <p className="text-orange-100 text-sm sm:text-base max-w-sm mx-auto">
            Discover local restaurants — order online for delivery or collection.
          </p>

          {/* Search input */}
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search restaurants, cuisine, dish…"
              aria-label="Search restaurants"
              className="pl-10 pr-10 h-12 bg-card border-0 text-sm shadow-xl rounded-xl focus-visible:ring-orange-400"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Filter toggle (mobile-friendly) */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((p) => !p)}
            aria-expanded={showFilters}
            className="bg-white/15 text-white border-white/50 hover:bg-white/25 hover:text-white gap-2 rounded-full px-5"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {hasFilters && (
              <span className="ml-0.5 bg-white text-orange-600 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                {[query, city, distance].filter(Boolean).length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="border-b bg-muted/50 px-4 py-4">
          <div className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="flex-1 h-9 text-sm rounded-lg">
                <SelectValue placeholder="City" />
              </SelectTrigger>
              <SelectContent>
                {CITIES.map((c) => (
                  <SelectItem key={c} value={c === 'All cities' ? '' : c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={distance} onValueChange={setDistance}>
              <SelectTrigger className="flex-1 h-9 text-sm rounded-lg">
                <SelectValue placeholder="Distance" />
              </SelectTrigger>
              <SelectContent>
                {DISTANCES.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSearch}
                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 shrink-0"
              >
                Clear all
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Result count / error */}
        {!loading && !error && stores.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{stores.length}</span>{' '}
              {stores.length !== 1 ? 'restaurants' : 'restaurant'} found
            </p>
            {hasFilters && (
              <Button
                variant="link"
                size="sm"
                onClick={clearSearch}
                className="h-auto p-0 text-xs text-primary"
              >
                Clear filters
              </Button>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm mb-5">
            <span className="shrink-0 text-base" role="img" aria-label="Error">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <StoreSkeleton key={i} />)
            : stores.map((store) => (
                <StoreCard key={store.id ?? store.slug} store={store} />
              ))}
        </div>

        {/* Empty state */}
        {!loading && !error && stores.length === 0 && (
          <div className="flex flex-col items-center text-center py-20 gap-4">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 border-2 border-primary/20"
              role="img"
              aria-label="No results"
            >
              <span className="text-4xl">🍽️</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">No restaurants found</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {hasFilters
                  ? 'Try adjusting your filters or search in a different area.'
                  : 'No restaurants are available right now — check back soon.'}
              </p>
            </div>
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearSearch}
                className="border-orange-300 text-orange-600 hover:bg-orange-50 rounded-full px-5"
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
