import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted variable fonts — no Google Fonts network call, works offline.
// Archivo carries both the weight (100-900) AND width (62%-125%) axes in one
// file, so the same download serves normal-width body copy and the
// condensed/black display type used for KDS tickets, order numbers and
// station headers — one family, two very different jobs.
import '@fontsource-variable/archivo/wdth.css';
// JetBrains Mono — order numbers, timers, prices, receipt lines. Tabular
// figures by default so columns of money and countdown clocks line up.
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import './i18n'; // initialise i18next — must precede render (Wave 30)
import App from './App.jsx';
import { StoreProvider } from '@/context/StoreContext'; // Wave 23 host→store resolution
import CookieConsent from '@/components/cookie-consent'; // Wave 42 cookie consent

// Wave 13 — offline Tier 1: register the service worker (app-shell + menu cache).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] registration failed', err);
    });
  });
}

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <StoreProvider>
      <App />
      <CookieConsent />
    </StoreProvider>
  </StrictMode>
);
