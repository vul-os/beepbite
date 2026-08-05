import { useNavigate } from 'react-router-dom';
import { MapPin, Star } from 'lucide-react';
import type { Store } from '@/services/marketplace';

// Renders only fields backend/internal/handlers/marketplace/store.go
// StoreListItem actually sends: id, name, slug, city, country, address,
// description, avg_rating. GET /stores has no cuisine, open/closed, cover
// image, currency, price-range, or delivery-time data at the list level —
// those exist (if at all) only on the single-store profile, or not at all.
export default function StoreCard({ store }: { store: Store }) {
  const navigate = useNavigate();

  const handleClick = () => {
    void navigate(`/store/${store.slug}`);
  };

  const ratingDisplay = store.avg_rating != null ? store.avg_rating.toFixed(1) : null;
  const location = [store.city, store.country].filter(Boolean).join(', ');

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`View ${store.name}`}
      onClick={handleClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      className="group cursor-pointer rounded-2xl overflow-hidden bg-card border border-border/60 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {/* Placeholder header — GET /stores sends no image field */}
      <div className="relative h-40 sm:h-48 bg-primary/5 overflow-hidden">
        <div className="w-full h-full flex items-center justify-center bg-primary/10">
          <span className="text-5xl" role="img" aria-hidden="true">🍽️</span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
      </div>

      <div className="p-3 sm:p-4 space-y-2">
        {/* Name */}
        <h3 className="font-display text-sm sm:text-base leading-tight line-clamp-1 text-foreground">
          {store.name}
        </h3>

        {/* Description */}
        {store.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {store.description}
          </p>
        )}

        {/* Meta chips row */}
        <div className="flex items-center gap-2.5 pt-0.5 flex-wrap">
          {ratingDisplay && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning bg-warning/10 border border-warning/25 px-1.5 py-0.5 rounded-md tabular-nums">
              <Star className="h-3 w-3 fill-warning text-warning" aria-hidden="true" />
              {ratingDisplay}
            </span>
          )}
          {location && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 text-primary/60" aria-hidden="true" />
              {location}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
