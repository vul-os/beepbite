/**
 * i18n configuration — Wave 30 / Now-20 scaffold
 *
 * Key-naming convention:
 *   <namespace>.<section>.<key>
 *   e.g.  nav.topBar.home   auth.signIn.title   common.save
 *
 * Usage:
 *   import { useTranslation } from 'react-i18next';
 *   const { t, i18n } = useTranslation();
 *   t('nav.topBar.home')          // → "Home" (en) / "Tuis" (af) / …
 *   t('onboarding.step', { current: 2, total: 4 })  // interpolation
 *
 * To switch language programmatically:
 *   i18n.changeLanguage('ar');   // also updates document dir via the
 *                                // languageChanged listener below
 *
 * This file is a side-effect import — just add:
 *   import './i18n';
 * before the React render call in src/main.jsx. No other wiring needed;
 * react-i18next's <I18nextProvider> is injected via initReactI18next.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// --- locale resources (static import so no network round-trip needed) ---
import en from './locales/en.json';
import af from './locales/af.json';
import zu from './locales/zu.json';
import xh from './locales/xh.json';
import pt from './locales/pt.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';

// The single namespace used across the app. A future sweep can split this
// into feature namespaces (e.g. 'nav', 'auth') if bundle size demands it.
const NS = 'translation';

const resources = {
  en: { [NS]: en },
  af: { [NS]: af },
  zu: { [NS]: zu },
  xh: { [NS]: xh },
  pt: { [NS]: pt },
  fr: { [NS]: fr },
  es: { [NS]: es },
  ar: { [NS]: ar },
  hi: { [NS]: hi },
};

/**
 * RTL languages supported by this app.
 * document.dir is set on every language change so CSS logical properties
 * (margin-inline-start, etc.) work without any extra class toggling.
 */
const RTL_LANGUAGES = new Set(['ar']);

function applyDocumentDir(lng) {
  document.documentElement.dir = RTL_LANGUAGES.has(lng) ? 'rtl' : 'ltr';
  // Also stamp a data attribute so CSS selectors like [data-lang="ar"] work.
  document.documentElement.setAttribute('data-lang', lng);
}

i18n
  .use(LanguageDetector)   // auto-detect from navigator / localStorage / cookie
  .use(initReactI18next)   // binds i18n instance into React context
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'af', 'zu', 'xh', 'pt', 'fr', 'es', 'ar', 'hi'],

    // LanguageDetector order: honour explicit localStorage choice first,
    // then browser navigator, then fall through to fallbackLng.
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'beepbite_language',
    },

    interpolation: {
      escapeValue: false, // React already escapes output
    },

    // Disable suspense by default — use explicit loading states instead.
    // Flip to true if you add lazy-loaded namespaces via i18next-http-backend.
    react: {
      useSuspense: false,
    },
  });

// Apply RTL/LTR direction on init and on every subsequent language change.
applyDocumentDir(i18n.language);
i18n.on('languageChanged', applyDocumentDir);

export default i18n;
