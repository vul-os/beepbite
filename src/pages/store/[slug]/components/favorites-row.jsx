import { useState, useEffect, useCallback } from 'react';
import { Heart, ShoppingCart, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPrice } from '@/lib/currency';
import { listFavorites, addFavorite, removeFavorite } from '@/services/favorites';

/**
 * FavoritesRow — horizontal scroll row of a customer's favourite items.
 *
 * Props:
 *   customerId {string}         UUID of the logged-in customer
 *   onAdd      {(item) => void} Called when the customer taps the quick-add
 *                               button; item shape: { item_id, name, price_cents }
 *   currency   {string}        ISO 4217 code (default 'USD')
 */
export default function FavoritesRow({ customerId, onAdd, currency = 'USD' }) {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Set of item_ids currently being toggled (prevents double-clicks).
  const [pending, setPending] = useState(new Set());

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listFavorites(customerId);
      setFavorites(data);
    } catch (err) {
      setError(err.message || 'Failed to load favorites');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  // Toggle heart: if already a favorite → remove; otherwise → add.
  const handleHeartToggle = useCallback(
    async (fav) => {
      const itemId = fav.item_id;
      if (pending.has(itemId)) return;
      setPending((prev) => new Set([...prev, itemId]));
      try {
        // Optimistic: remove from local state immediately.
        setFavorites((prev) => prev.filter((f) => f.item_id !== itemId));
        await removeFavorite(customerId, itemId);
      } catch {
        // Revert on failure.
        setFavorites((prev) => [fav, ...prev]);
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [customerId, pending],
  );

  // Allow adding a non-favourite item as favourite from outside (not shown in
  // this row directly, but exposed via a prop so parent pages can wire it up).
  const handleAddFavorite = useCallback(
    async (itemId) => {
      if (pending.has(itemId)) return;
      setPending((prev) => new Set([...prev, itemId]));
      try {
        const fi = await addFavorite(customerId, itemId);
        setFavorites((prev) => {
          // Avoid duplicates.
          if (prev.some((f) => f.item_id === fi.item_id)) return prev;
          return [fi, ...prev];
        });
      } catch {
        // Silently ignore — caller's UI can handle the error.
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [customerId, pending],
  );

  // Expose addFavorite so parent can call it without re-importing the service.
  FavoritesRow.addFavorite = handleAddFavorite;

  if (!customerId) return null;

  // --- Loading skeletons ---
  if (loading) {
    return (
      <section aria-label="Customer favorites" className="py-3">
        <h2 className="px-4 text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <Heart className="w-4 h-4 text-rose-400" aria-hidden="true" />
          Your Favorites
        </h2>
        <div className="flex gap-3 px-4 overflow-x-auto pb-1">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex-shrink-0 w-36 rounded-xl border border-border bg-card p-3 space-y-2">
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-7 w-full rounded-md" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <section aria-label="Customer favorites" className="py-3 px-4">
        <p className="text-xs text-destructive">{error}</p>
      </section>
    );
  }

  // --- Empty state ---
  if (favorites.length === 0) {
    return (
      <section aria-label="Customer favorites" className="py-3 px-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Heart className="w-4 h-4 text-rose-300" aria-hidden="true" />
          <span>No favorites yet — tap the heart on any item to save it here.</span>
        </div>
      </section>
    );
  }

  // --- Favorites row ---
  return (
    <section aria-label="Customer favorites" className="py-3">
      <h2 className="px-4 text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Heart className="w-4 h-4 fill-rose-500 text-rose-500" aria-hidden="true" />
        Your Favorites
      </h2>
      <div
        className="flex gap-3 px-4 overflow-x-auto pb-1 snap-x snap-mandatory scroll-smooth"
        role="list"
        aria-label="Favorite items"
      >
        {favorites.map((fav) => (
          <FavoriteCard
            key={fav.id}
            fav={fav}
            currency={currency}
            onAdd={onAdd}
            onRemove={handleHeartToggle}
            isPending={pending.has(fav.item_id)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal card component
// ---------------------------------------------------------------------------

function FavoriteCard({ fav, currency, onAdd, onRemove, isPending }) {
  return (
    <article
      role="listitem"
      className="flex-shrink-0 snap-start w-36 rounded-xl border border-border bg-card shadow-sm overflow-hidden
                 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring"
      aria-label={fav.name}
    >
      {/* Image */}
      <div className="relative h-20 w-full bg-muted">
        {fav.image_url ? (
          <img
            src={fav.image_url}
            alt={fav.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Star className="w-6 h-6 text-muted-foreground/30" aria-hidden="true" />
          </div>
        )}
        {/* Heart toggle */}
        <button
          aria-label={`Remove ${fav.name} from favorites`}
          disabled={isPending}
          onClick={() => onRemove(fav)}
          className="absolute top-1 right-1 p-1 rounded-full bg-background/70 backdrop-blur-sm
                     text-rose-500 hover:bg-background/90 disabled:opacity-50 transition-colors"
        >
          <Heart className="w-3.5 h-3.5 fill-rose-500" aria-hidden="true" />
        </button>
      </div>

      {/* Details */}
      <div className="p-2 space-y-1">
        <p className="text-xs font-medium text-foreground leading-tight line-clamp-2">
          {fav.name}
        </p>
        <p className="text-xs text-muted-foreground font-semibold">
          {formatPrice(fav.price_cents, currency)}
        </p>
        {/* Quick-add button */}
        {onAdd && (
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-[11px] gap-1 px-1"
            aria-label={`Add ${fav.name} to cart`}
            onClick={() => onAdd({ item_id: fav.item_id, name: fav.name, price_cents: fav.price_cents, image_url: fav.image_url })}
          >
            <ShoppingCart className="w-3 h-3" aria-hidden="true" />
            Add
          </Button>
        )}
      </div>
    </article>
  );
}
