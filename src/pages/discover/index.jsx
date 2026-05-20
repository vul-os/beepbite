import React, { useState, useEffect, useCallback, useRef } from 'react';
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
    <div className="overflow-hidden rounded-lg border bg-card">
      <Skeleton className="h-36 sm:h-44 w-full rounded-none" />
      <div className="p-3 sm:p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
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
      <div className="bg-gradient-to-br from-orange-500 to-orange-600 px-4 py-8 sm:py-12">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            Find food near you
          </h1>
          <p className="text-orange-100 text-sm sm:text-base">
            Discover local restaurants, order online and collect or get delivery.
          </p>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search restaurants, cuisine, dish…"
              className="pl-10 pr-10 h-11 bg-white border-0 text-sm shadow-lg"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filter toggle (mobile-friendly) */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((p) => !p)}
            className="bg-white/20 text-white border-white/40 hover:bg-white/30 hover:text-white gap-2"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {hasFilters && (
              <span className="ml-1 bg-white text-orange-600 rounded-full px-1.5 py-0 text-xs font-semibold">
                {[query, city, distance].filter(Boolean).length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="border-b bg-muted/40 px-4 py-3">
          <div className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3">
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="flex-1 h-9 text-sm">
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
              <SelectTrigger className="flex-1 h-9 text-sm">
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
                className="text-muted-foreground"
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
        {!loading && !error && (
          <p className="text-sm text-muted-foreground mb-4">
            {stores.length === 0
              ? 'No stores found'
              : `${stores.length} store${stores.length !== 1 ? 's' : ''} found`}
            {hasFilters && ' · '}
            {hasFilters && (
              <button
                onClick={clearSearch}
                className="text-orange-500 hover:underline"
              >
                Clear filters
              </button>
            )}
          </p>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <StoreSkeleton key={i} />)
            : stores.map((store) => (
                <StoreCard key={store.id ?? store.slug} store={store} />
              ))}
        </div>

        {/* Empty state */}
        {!loading && !error && stores.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <div className="text-5xl">🍽️</div>
            <h2 className="text-lg font-semibold">No restaurants found</h2>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search or filters.
            </p>
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearSearch}
                className="border-orange-300 text-orange-600 hover:bg-orange-50"
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
