import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { MapPin, Star, Clock, Navigation } from 'lucide-react';
import { formatPrice } from '@/lib/currency';

/**
 * StoreCard — compact card shown in the /discover grid.
 *
 * Props:
 *   store: { slug, name, description, city, cuisine_type, rating, review_count,
 *             distance_km, is_open, cover_image_url, logo_url,
 *             currency, min_price_cents, max_price_cents }
 */
export default function StoreCard({ store }) {
  const currency = store?.currency || store?.default_currency_code || store?.currency_code || 'USD';
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/store/${store.slug}`);
  };

  const ratingDisplay = store.rating
    ? Number(store.rating).toFixed(1)
    : null;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`View ${store.name}`}
      onClick={handleClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      className="group cursor-pointer rounded-2xl overflow-hidden bg-card border border-border/60 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
    >
      {/* Cover image */}
      <div className="relative h-40 sm:h-48 bg-orange-50 overflow-hidden">
        {store.cover_image_url ? (
          <img
            src={store.cover_image_url}
            alt={store.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-100 to-amber-100">
            <span className="text-5xl" role="img" aria-hidden="true">🍽️</span>
          </div>
        )}

        {/* Gradient overlay for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />

        {/* Open/closed pill — bottom-left over the gradient */}
        <span
          className={`absolute bottom-2 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow ${
            store.is_open
              ? 'bg-green-500 text-white'
              : 'bg-black/60 text-white/80'
          }`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${store.is_open ? 'bg-white' : 'bg-gray-400'}`} />
          {store.is_open ? 'Open' : 'Closed'}
        </span>

        {/* Cuisine badge — top-right */}
        {store.cuisine_type && (
          <Badge
            variant="secondary"
            className="absolute top-2 right-2 text-[11px] bg-white/90 text-orange-700 border-0 shadow-sm"
          >
            {store.cuisine_type}
          </Badge>
        )}
      </div>

      <div className="p-3 sm:p-4 space-y-2">
        {/* Name */}
        <h3 className="font-bold text-sm sm:text-base leading-tight line-clamp-1 text-foreground">
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
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
              {ratingDisplay}
              {store.review_count ? (
                <span className="text-muted-foreground font-normal">({store.review_count})</span>
              ) : null}
            </span>
          )}
          {store.distance_km != null && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Navigation className="h-3 w-3 text-orange-400" aria-hidden="true" />
              {store.distance_km < 1
                ? `${Math.round(store.distance_km * 1000)} m`
                : `${Number(store.distance_km).toFixed(1)} km`}
            </span>
          )}
          {store.city && !store.distance_km && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 text-orange-400" aria-hidden="true" />
              {store.city}
            </span>
          )}
          {store.delivery_time_min && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 text-orange-400" aria-hidden="true" />
              {store.delivery_time_min}–{store.delivery_time_max ?? store.delivery_time_min + 10} min
            </span>
          )}
        </div>

        {/* Price range footer */}
        {store.min_price_cents != null && store.max_price_cents != null && (
          <p className="text-xs text-muted-foreground pt-0.5">
            {formatPrice(store.min_price_cents, currency)}–{formatPrice(store.max_price_cents, currency)}
          </p>
        )}
      </div>
    </article>
  );
}
