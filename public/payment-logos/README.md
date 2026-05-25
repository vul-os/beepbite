# Payment provider brand assets

The `ProviderLogo` component at `src/pages/settings/location/payments/provider-logo.jsx`
loads SVG files from this directory by filename: `<provider>.svg`.

If the file is missing or fails to load, the component falls back to a tasteful
brand-colored wordmark — so the UI never breaks, it just looks better with real
assets.

## Drop in the official SVGs

Download the official brand assets directly from each provider's brand page and
save them here with the filenames below. Do not modify, restyle, or recolor the
marks — use them as published.

| File           | Source                                                  |
|----------------|---------------------------------------------------------|
| `paystack.svg` | https://paystack.com/brand                              |
| `stripe.svg`   | https://stripe.com/newsroom/brand-assets                |
| `payfast.svg`  | https://www.payfast.co.za/                              |

Each provider's brand kit also includes usage guidelines. Stay within them.
