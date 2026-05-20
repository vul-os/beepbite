import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Star, Clock } from 'lucide-react';
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
    <Card
      className="cursor-pointer overflow-hidden hover:shadow-md transition-shadow group"
      onClick={handleClick}
    >
      {/* Cover image */}
      <div className="relative h-36 sm:h-44 bg-orange-50 overflow-hidden">
        {store.cover_image_url ? (
          <img
            src={store.cover_image_url}
            alt={store.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-100 to-orange-200">
            <span className="text-4xl">🍽️</span>
          </div>
        )}

        {/* Open/closed badge */}
        <Badge
          className={`absolute top-2 right-2 text-xs ${
            store.is_open
              ? 'bg-green-500 hover:bg-green-500'
              : 'bg-gray-500 hover:bg-gray-500'
          }`}
        >
          {store.is_open ? 'Open' : 'Closed'}
        </Badge>
      </div>

      <CardContent className="p-3 sm:p-4 space-y-1">
        {/* Name + cuisine */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm sm:text-base leading-tight line-clamp-1">
            {store.name}
          </h3>
          {store.cuisine_type && (
            <Badge variant="outline" className="text-xs shrink-0 border-orange-300 text-orange-600">
              {store.cuisine_type}
            </Badge>
          )}
        </div>

        {/* Description */}
        {store.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {store.description}
          </p>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground flex-wrap">
          {store.city && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-orange-500" />
              {store.city}
            </span>
          )}
          {store.distance_km != null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-orange-500" />
              {store.distance_km < 1
                ? `${Math.round(store.distance_km * 1000)}m`
                : `${Number(store.distance_km).toFixed(1)}km`}
            </span>
          )}
          {ratingDisplay && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3 fill-orange-400 text-orange-400" />
              {ratingDisplay}
              {store.review_count ? ` (${store.review_count})` : ''}
            </span>
          )}
          {store.min_price_cents != null && store.max_price_cents != null && (
            <span className="flex items-center gap-1">
              {formatPrice(store.min_price_cents, currency)}–{formatPrice(store.max_price_cents, currency)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
