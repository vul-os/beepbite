// i18n.test.js — unit tests for src/i18n/index.js
//
// Tests (pure, no network, jsdom environment):
//   1. All locale JSON files parse correctly and expose the same
//      *translation* top-level keys as en.json (private meta-keys
//      prefixed with "_" are excluded from the parity check).
//   2. The i18n instance initialises with fallbackLng 'en'.
//   3. changeLanguage + t() returns the locale value; missing keys
//      fall back to English.

import { describe, it, expect, beforeAll } from 'vitest';

// --- raw locale JSON (same static imports the source uses) ---
import en from '../i18n/locales/en.json';
import af from '../i18n/locales/af.json';
import zu from '../i18n/locales/zu.json';
import xh from '../i18n/locales/xh.json';
import pt from '../i18n/locales/pt.json';
import fr from '../i18n/locales/fr.json';
import es from '../i18n/locales/es.json';
import ar from '../i18n/locales/ar.json';
import hi from '../i18n/locales/hi.json';

// Side-effect import — self-initialises the i18n instance (also sets
// document.dir via the languageChanged listener, which is fine in jsdom).
import i18n from '../i18n/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect every dot-joined leaf path in a nested object.
 * e.g. { a: { b: 'x' } } → ['a.b']
 */
function leafPaths(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === 'object' ? leafPaths(v, path) : [path];
  });
}

// Translation keys in en.json — private meta-keys (prefixed with "_") are
// intentionally absent from other locale files and are excluded from the check.
const enTranslationKeys = leafPaths(en).filter((k) => !k.startsWith('_'));

const LOCALES = { af, zu, xh, pt, fr, es, ar, hi };

// ---------------------------------------------------------------------------
// 1. Locale parity — every locale must have the same keys as en (minus "_")
// ---------------------------------------------------------------------------

describe('locale key parity (all locales vs en.json)', () => {
  Object.entries(LOCALES).forEach(([code, resource]) => {
    describe(`locale: ${code}`, () => {
      const localeKeys = leafPaths(resource);

      enTranslationKeys.forEach((key) => {
        it(`has key "${key}"`, () => {
          expect(localeKeys).toContain(key);
        });
      });

      it('has no extra leaf keys beyond en (excluding en meta-keys)', () => {
        // Extra keys are not a hard error (they are only additive) but we flag
        // them so the reporter surfaces them.
        const enAllPaths = leafPaths(en); // includes "_" keys
        const extra = localeKeys.filter(
          (k) => !enAllPaths.includes(k),
        );
        // Log for visibility; we do not fail the test because forward-only
        // additions are harmless, but a non-empty extra array is worth noting.
        if (extra.length > 0) {
          console.warn(
            `[i18n] locale "${code}" has extra keys not in en.json:`,
            extra,
          );
        }
        // This assertion stays — callers decide what to do with warnings above.
        expect(extra).toEqual([]);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 2. i18n instance initialises with fallback language 'en'
// ---------------------------------------------------------------------------

describe('i18n instance initialisation', () => {
  it('is initialised (i18n.isInitialized is true)', () => {
    expect(i18n.isInitialized).toBe(true);
  });

  it('has fallbackLng set to "en"', () => {
    // i18next normalises fallbackLng to an array internally.
    const fallback = i18n.options.fallbackLng;
    const fallbackArr = Array.isArray(fallback) ? fallback : [fallback];
    expect(fallbackArr).toContain('en');
  });

  it('supports all expected language codes', () => {
    const supported = i18n.options.supportedLngs;
    ['en', 'af', 'zu', 'xh', 'pt', 'fr', 'es', 'ar', 'hi'].forEach((code) => {
      expect(supported).toContain(code);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. changeLanguage + t() — locale values and fallback behaviour
// ---------------------------------------------------------------------------

describe('changeLanguage and t()', () => {
  // Each test switches language and then restores to avoid leaking state.

  it('t("nav.topBar.home") returns Afrikaans value after changeLanguage("af")', async () => {
    await i18n.changeLanguage('af');
    expect(i18n.t('nav.topBar.home')).toBe('Tuis');
    await i18n.changeLanguage('en');
  });

  it('t("nav.topBar.home") returns Arabic value after changeLanguage("ar")', async () => {
    await i18n.changeLanguage('ar');
    expect(i18n.t('nav.topBar.home')).toBe('الرئيسية');
    await i18n.changeLanguage('en');
  });

  it('t("nav.topBar.home") returns French value after changeLanguage("fr")', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('nav.topBar.home')).toBe('Accueil');
    await i18n.changeLanguage('en');
  });

  it('t("onboarding.step") with interpolation works for "es"', async () => {
    await i18n.changeLanguage('es');
    // es value: "Paso {{current}} de {{total}}"
    expect(i18n.t('onboarding.step', { current: 2, total: 5 })).toBe(
      'Paso 2 de 5',
    );
    await i18n.changeLanguage('en');
  });

  it('falls back to English for a key missing from a locale', async () => {
    // Inject a test locale that deliberately omits 'common.language'.
    i18n.addResourceBundle('xx', 'translation', { nav: { topBar: { home: 'XX Home' } } }, true, true);
    await i18n.changeLanguage('xx');

    // 'common.language' is not present in 'xx' → should fall back to 'en' value
    const result = i18n.t('common.language');
    expect(result).toBe('Language'); // en.json value

    // Clean up test locale and restore.
    i18n.removeResourceBundle('xx', 'translation');
    await i18n.changeLanguage('en');
  });

  it('sets document.dir to "rtl" when language is "ar"', async () => {
    await i18n.changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    await i18n.changeLanguage('en');
  });

  it('sets document.dir to "ltr" when language is "en"', async () => {
    await i18n.changeLanguage('ar'); // go rtl first
    await i18n.changeLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
