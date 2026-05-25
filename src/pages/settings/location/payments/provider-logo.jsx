import React, { useState } from 'react';

const BRAND = {
  paystack: { color: '#0BA4DB', bg: '#E6F6FD', label: 'Paystack' },
  stripe:   { color: '#635BFF', bg: '#EFEEFF', label: 'Stripe' },
  payfast:  { color: '#E94E1B', bg: '#FDECE5', label: 'PayFast' },
};

export function ProviderLogo({ provider, size = 48 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const brand = BRAND[provider] ?? { color: '#475569', bg: '#F1F5F9', label: provider };

  return (
    <div
      className="flex items-center justify-center rounded-lg overflow-hidden shrink-0"
      style={{ width: size, height: size, backgroundColor: brand.bg }}
      aria-label={`${brand.label} logo`}
    >
      {!imgFailed ? (
        <img
          src={`/payment-logos/${provider}.svg`}
          alt={`${brand.label} logo`}
          className="w-3/4 h-3/4 object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span
          className="text-[11px] font-bold tracking-tight"
          style={{ color: brand.color }}
        >
          {brand.label}
        </span>
      )}
    </div>
  );
}
