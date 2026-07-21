import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter'; // self-hosted Inter (300-900) — no Google Fonts network call
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
