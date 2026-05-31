import React, { useState } from 'react';

const BRAND = {
  paystack: { color: '#0BA4DB', bg: '#E6F6FD', label: 'Paystack' },
  stripe:   { color: '#635BFF', bg: '#EFEEFF', label: 'Stripe' },
  payfast:  { color: '#E94E1B', bg: '#FDECE5', label: 'PayFast' },
};

// Tries each extension in order until one loads; falls back to a brand-colored
// wordmark if all fail.
const EXT_ORDER = ['svg', 'png'];

export function ProviderLogo({ provider }) {
  const [extIdx, setExtIdx] = useState(0);
  const [allFailed, setAllFailed] = useState(false);
  const brand = BRAND[provider] ?? { color: '#475569', bg: '#F1F5F9', label: provider };

  function handleError() {
    if (extIdx < EXT_ORDER.length - 1) setExtIdx(extIdx + 1);
    else setAllFailed(true);
  }

  return (
    <div
      className="flex items-center justify-center rounded-lg shrink-0 h-12 min-w-12 max-w-[160px] px-2"
      style={{ backgroundColor: brand.bg }}
      aria-label={`${brand.label} logo`}
    >
      {!allFailed ? (
        <img
          key={extIdx}
          src={`/payment-logos/${provider}.${EXT_ORDER[extIdx]}`}
          alt={`${brand.label} logo`}
          className="h-7 w-auto max-w-full object-contain"
          onError={handleError}
        />
      ) : (
        <span
          className="text-xs font-bold tracking-tight whitespace-nowrap"
          style={{ color: brand.color }}
        >
          {brand.label}
        </span>
      )}
    </div>
  );
}
