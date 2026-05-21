/**
 * ReviewPrompt — compact "Rate your order" widget for the tracking page.
 *
 * Shows after delivery.  Lets the customer pick 1–5 stars and optionally add
 * a comment, then calls POST /reviews.  Gracefully handles 409 (already
 * reviewed) and shows a thank-you state on success.
 *
 * Props:
 *   orderId   {string}            — order UUID to associate the review with
 *   onSuccess {function?}         — optional callback fired after successful submission
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitReview } from '@/services/reviews';
import { cn } from '@/lib/utils';

// ── Interactive star picker ───────────────────────────────────────────────────

function StarPicker({ value, onChange, disabled }) {
  const [hovered, setHovered] = useState(0);
  const active = hovered || value;

  return (
    <div
      className="inline-flex items-center gap-1"
      role="radiogroup"
      aria-label="Star rating"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          disabled={disabled}
          className={cn(
            'transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded',
            !disabled && 'hover:scale-110 cursor-pointer',
            disabled && 'cursor-default',
          )}
          onMouseEnter={() => !disabled && setHovered(n)}
          onClick={() => !disabled && onChange(n)}
        >
          <svg
            viewBox="0 0 20 20"
            className={cn(
              'h-8 w-8 transition-colors',
              n <= active ? 'text-orange-500' : 'text-gray-200',
            )}
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

// ── Star label copy ───────────────────────────────────────────────────────────

const STAR_LABELS = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Great',
  5: 'Excellent!',
};

// ── Thank-you state ───────────────────────────────────────────────────────────

function ThankYouView() {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-2">
      {/* Orange checkmark circle */}
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 border border-orange-200">
        <svg viewBox="0 0 20 20" className="h-6 w-6 text-orange-500" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <p className="text-sm font-semibold text-foreground">Thanks for your feedback!</p>
      <p className="text-xs text-muted-foreground">Your review helps others find great food.</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReviewPrompt({ orderId, onSuccess }) {
  const [stars,       setStars]       = useState(0);
  const [text,        setText]        = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [error,       setError]       = useState(null);

  const canSubmit = stars > 0 && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const { error: err } = await submitReview({
      orderId,
      stars,
      text: text.trim() || undefined,
    });

    setSubmitting(false);

    if (err) {
      if (err.status === 409) {
        // Already reviewed — treat as soft success
        setAlreadyDone(true);
        setSubmitted(true);
        return;
      }
      setError(err.message || 'Could not submit your review. Please try again.');
      return;
    }

    setSubmitted(true);
    onSuccess?.();
  }

  // ---- Already reviewed (409) or successful submission ----
  if (submitted) {
    return (
      <div className="rounded-xl border bg-card shadow-sm px-5 py-5">
        {alreadyDone ? (
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">You've already reviewed this order.</p>
            <p className="text-xs text-muted-foreground mt-1">Thank you for your feedback!</p>
          </div>
        ) : (
          <ThankYouView />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Rate your order
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Star picker */}
        <div className="flex flex-col items-center gap-1">
          <StarPicker value={stars} onChange={setStars} disabled={submitting} />
          {stars > 0 && (
            <p className="text-xs font-medium text-orange-600 h-4">
              {STAR_LABELS[stars]}
            </p>
          )}
          {stars === 0 && (
            <p className="text-xs text-muted-foreground h-4">Tap a star to rate</p>
          )}
        </div>

        {/* Optional text */}
        {stars > 0 && (
          <Textarea
            placeholder="Tell us about your experience (optional)…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
            rows={3}
            className="resize-none text-sm"
          />
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-red-600 text-center">{error}</p>
        )}

        {/* Submit */}
        <Button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            'w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold',
            (!canSubmit) && 'opacity-50 cursor-not-allowed',
          )}
        >
          {submitting ? 'Submitting…' : 'Submit review'}
        </Button>
      </form>
    </div>
  );
}
