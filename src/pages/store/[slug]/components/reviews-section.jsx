/**
 * ReviewsSection — public reviews for a store's marketplace page.
 *
 * Props:
 *   slug        {string}  — store URL slug; used to call GET /stores/{slug}/reviews
 *   avgStars    {number}  — pre-computed average rating (optional; shown in header if provided)
 *   reviewCount {number}  — total review count  (optional; shown in header if provided)
 *   limit       {number}  — max reviews to fetch (default 20)
 */

import React, { useEffect, useId, useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fetchStoreReviews } from '@/services/reviews';
import { cn } from '@/lib/utils';

// ── Star primitives ──────────────────────────────────────────────────────────

/**
 * Render a row of 1–5 filled/empty stars.
 * `value` should be a number 1–5 (floats are rounded to nearest half for display).
 */
function StarRow({ value = 0, size = 'sm', className }) {
  const uid = useId();
  const sizeClass = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value >= n;
        const half   = !filled && value >= n - 0.5;
        return (
          <svg
            key={n}
            viewBox="0 0 20 20"
            className={cn(sizeClass, filled || half ? 'text-orange-500' : 'text-gray-200')}
            fill="currentColor"
            aria-hidden="true"
          >
            {half ? (
              // half-filled star using clip
              <>
                <defs>
                  <clipPath id={`half-${uid}-${n}`}>
                    <rect x="0" y="0" width="10" height="20" />
                  </clipPath>
                </defs>
                {/* grey base */}
                <path
                  d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                  className="text-gray-200"
                />
                {/* orange left half */}
                <path
                  clipPath={`url(#half-${uid}-${n})`}
                  d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                  className="text-orange-500"
                />
              </>
            ) : (
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            )}
          </svg>
        );
      })}
    </span>
  );
}

// ── Aggregate header ──────────────────────────────────────────────────────────

function AggregateHeader({ avgStars, reviewCount, liveAvg, liveCount }) {
  const avg   = avgStars   ?? liveAvg   ?? null;
  const count = reviewCount ?? liveCount ?? 0;

  if (avg === null) return null;

  const displayAvg = Math.round(avg * 10) / 10;

  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="text-4xl font-bold text-foreground leading-none">
        {displayAvg.toFixed(1)}
      </span>
      <div>
        <StarRow value={avg} size="lg" />
        <p className="text-xs text-muted-foreground mt-1">
          {count === 0
            ? 'No reviews yet'
            : `${count} review${count === 1 ? '' : 's'}`}
        </p>
      </div>
    </div>
  );
}

// ── Individual review card ────────────────────────────────────────────────────

function ReviewCard({ review }) {
  const {
    stars,
    text,
    photos = [],
    created_at,
    owner_reply,
    owner_replied_at,
  } = review;

  const relativeDate = created_at
    ? formatDistanceToNow(parseISO(created_at), { addSuffix: true })
    : null;

  const replyDate = owner_replied_at
    ? formatDistanceToNow(parseISO(owner_replied_at), { addSuffix: true })
    : null;

  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-4 space-y-3">
      {/* Rating + date */}
      <div className="flex items-center justify-between gap-2">
        <StarRow value={stars ?? 0} />
        {relativeDate && (
          <span className="text-xs text-muted-foreground shrink-0">{relativeDate}</span>
        )}
      </div>

      {/* Review text */}
      {text && (
        <p className="text-sm text-foreground leading-relaxed">{text}</p>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((url, idx) => (
            <div
              key={idx}
              className="h-16 w-16 rounded-md overflow-hidden bg-muted border shrink-0"
            >
              <img
                src={url}
                alt={`Review photo ${idx + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}

      {/* Owner reply */}
      {owner_reply && (
        <div className="ml-4 pl-3 border-l-2 border-orange-300 space-y-0.5">
          <p className="text-xs font-semibold text-orange-600">Owner reply</p>
          {replyDate && (
            <p className="text-xs text-muted-foreground">{replyDate}</p>
          )}
          <p className="text-sm text-foreground leading-relaxed">{owner_reply}</p>
        </div>
      )}
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ReviewSkeleton() {
  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-4 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 w-4 rounded bg-muted" />
          ))}
        </div>
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-3/4 rounded bg-muted" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReviewsSection({
  slug,
  avgStars,
  reviewCount,
  limit = 20,
}) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Compute live aggregate from fetched data when props not provided.
  const liveAvg = reviews.length
    ? Math.round((reviews.reduce((s, r) => s + (r.stars ?? 0), 0) / reviews.length) * 10) / 10
    : null;
  const liveCount = reviews.length;

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchStoreReviews(slug, limit).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) {
        setError(err.message || 'Failed to load reviews');
        setLoading(false);
        return;
      }
      setReviews(Array.isArray(data) ? data : []);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [slug, limit]);

  return (
    <section aria-label="Customer reviews">
      {/* Aggregate header */}
      <AggregateHeader
        avgStars={avgStars}
        reviewCount={reviewCount}
        liveAvg={liveAvg}
        liveCount={liveCount}
      />

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <ReviewSkeleton key={i} />)}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && reviews.length === 0 && (
        <div className="rounded-xl border bg-card px-5 py-8 text-center">
          <p className="text-sm font-medium text-foreground mb-1">No reviews yet</p>
          <p className="text-xs text-muted-foreground">Be the first to leave a review after ordering.</p>
        </div>
      )}

      {/* Review list */}
      {!loading && !error && reviews.length > 0 && (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </section>
  );
}
