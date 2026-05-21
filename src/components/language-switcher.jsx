/**
 * LanguageSwitcher — keyboard-accessible language selector
 *
 * A11y choices documented here (reference pattern for other dropdowns):
 *
 *  Role model: ARIA Listbox pattern (aria-haspopup="listbox")
 *    - The trigger button announces the popup type to screen readers.
 *    - The popup container gets role="listbox" + aria-label so AT can name it.
 *    - Each option gets role="option" + aria-selected so AT announces selection.
 *
 *  Keyboard contract:
 *    Enter / Space  → open the listbox when closed; select focused option when open
 *    ArrowDown      → move focus to next option (wraps to first)
 *    ArrowUp        → move focus to previous option (wraps to last)
 *    Home           → jump to first option
 *    End            → jump to last option
 *    Escape         → close without changing language
 *    Tab            → close and move focus to next element in the page
 *
 *  Focus management:
 *    - On open, focus moves to the currently selected option so the user
 *      immediately hears which language is active.
 *    - On close (Esc / selection), focus returns to the trigger button.
 *    - Individual options receive tabIndex="-1" so only the trigger sits in
 *      the natural tab order when the listbox is closed.
 *
 *  Visual focus ring:
 *    focus-visible:ring-2 is used (not focus:ring-2) to suppress the ring
 *    for pointer interactions while keeping it for keyboard navigation.
 *
 *  Reduced motion:
 *    Transition classes use motion-safe: prefix so animation is skipped for
 *    users who have prefers-reduced-motion: reduce.
 *
 * Usage:
 *   import LanguageSwitcher from '@/components/language-switcher';
 *   <LanguageSwitcher />
 *
 *   Optional props:
 *     className  — extra Tailwind classes on the root <div>
 *     compact    — boolean; show flag + code only (no full label), default false
 */

import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';

// --------------------------------------------------------------------------
// Language catalogue — extend here when new locales are added to i18n/index.js
// --------------------------------------------------------------------------
const LANGUAGES = [
  { code: 'en', label: 'English',    nativeLabel: 'English',    flag: '🇬🇧' },
  { code: 'af', label: 'Afrikaans',  nativeLabel: 'Afrikaans',  flag: '🇿🇦' },
  { code: 'zu', label: 'Zulu',       nativeLabel: 'isiZulu',    flag: '🇿🇦' },
  { code: 'xh', label: 'Xhosa',      nativeLabel: 'isiXhosa',   flag: '🇿🇦' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português',  flag: '🇧🇷' },
  { code: 'fr', label: 'French',     nativeLabel: 'Français',   flag: '🇫🇷' },
  { code: 'es', label: 'Spanish',    nativeLabel: 'Español',    flag: '🇪🇸' },
  { code: 'ar', label: 'Arabic',     nativeLabel: 'العربية',    flag: '🇸🇦' },
  { code: 'hi', label: 'Hindi',      nativeLabel: 'हिन्दी',      flag: '🇮🇳' },
];

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------
const LanguageSwitcher = ({ className = '', compact = false }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  // focusedIndex tracks which option has the in-list focus (keyboard cursor).
  const [focusedIndex, setFocusedIndex] = useState(0);

  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const optionRefs = useRef([]); // one ref per option element

  // Stable unique IDs for ARIA attributes (avoids SSR / StrictMode collisions).
  const uid = useId();
  const listboxId = `lang-listbox-${uid}`;
  const triggerId = `lang-trigger-${uid}`;

  // Resolve the currently active language, defaulting to 'en'.
  const activeLng = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];
  const activeIndex = LANGUAGES.findIndex((l) => l.code === i18n.language);

  // ------------------------------------------------------------------
  // Open / close helpers
  // ------------------------------------------------------------------
  const openListbox = useCallback(() => {
    const idx = activeIndex >= 0 ? activeIndex : 0;
    setFocusedIndex(idx);
    setIsOpen(true);
  }, [activeIndex]);

  const closeListbox = useCallback((returnFocus = true) => {
    setIsOpen(false);
    if (returnFocus) {
      // Small rAF so React has time to remove the listbox from the DOM before
      // we try to focus the trigger (avoids a focus race in StrictMode).
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  // ------------------------------------------------------------------
  // Language selection
  // ------------------------------------------------------------------
  const selectLanguage = useCallback((code) => {
    i18n.changeLanguage(code);
    // Persist choice; the LanguageDetector also reads this key.
    try {
      localStorage.setItem('beepbite_language', code);
    } catch {
      // localStorage unavailable (private browsing, quota) — silently ignore.
    }
    closeListbox(true);
  }, [closeListbox]);

  // ------------------------------------------------------------------
  // Focus management: move DOM focus to the option at focusedIndex when the
  // listbox is open and focusedIndex changes.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (isOpen && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex].focus();
    }
  }, [isOpen, focusedIndex]);

  // ------------------------------------------------------------------
  // Close on outside click or focus leaving the component.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      if (!listRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        closeListbox(false);
      }
    };

    // Close when focus moves completely outside the component tree.
    const handleFocusOut = (e) => {
      // e.relatedTarget is where focus is going; null means focus left the page.
      if (!listRef.current?.contains(e.relatedTarget) && !triggerRef.current?.contains(e.relatedTarget)) {
        closeListbox(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [isOpen, closeListbox]);

  // ------------------------------------------------------------------
  // Keyboard handler for the trigger button.
  // ------------------------------------------------------------------
  const handleTriggerKeyDown = (e) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        e.preventDefault();
        openListbox();
        break;
      case 'ArrowUp':
        e.preventDefault();
        // Open with last option focused.
        setFocusedIndex(LANGUAGES.length - 1);
        setIsOpen(true);
        break;
      default:
        break;
    }
  };

  // ------------------------------------------------------------------
  // Keyboard handler for option elements inside the listbox.
  // ------------------------------------------------------------------
  const handleOptionKeyDown = (e, index) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectLanguage(LANGUAGES[index].code);
        break;
      case 'Escape':
        e.preventDefault();
        closeListbox(true);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((i) => (i + 1) % LANGUAGES.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((i) => (i - 1 + LANGUAGES.length) % LANGUAGES.length);
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(LANGUAGES.length - 1);
        break;
      case 'Tab':
        // Let Tab close the popup and move to the next focusable element naturally.
        closeListbox(false);
        break;
      default:
        break;
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className={`relative inline-block ${className}`}>
      {/* --- Trigger button --- */}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={`${t('common.language')}: ${activeLng.nativeLabel}`}
        onClick={() => (isOpen ? closeListbox(true) : openListbox())}
        onKeyDown={handleTriggerKeyDown}
        className={[
          // Base layout
          'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium',
          // Colours — match the app's orange accent palette
          'border border-gray-300 bg-white text-gray-700',
          'hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50',
          // Focus ring — visible only for keyboard (focus-visible)
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2',
          // Transition — skip for prefers-reduced-motion users
          'motion-safe:transition-all motion-safe:duration-150',
        ].join(' ')}
      >
        <span aria-hidden="true" className="text-base leading-none">{activeLng.flag}</span>
        {!compact && (
          <span className="hidden sm:inline">{activeLng.nativeLabel}</span>
        )}
        <span className="inline sm:hidden font-mono text-xs">{activeLng.code.toUpperCase()}</span>
        {/* Chevron icon — rotates when open */}
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`motion-safe:transition-transform motion-safe:duration-150 ${isOpen ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* --- Listbox dropdown --- */}
      {isOpen && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('common.language')}
          aria-labelledby={triggerId}
          // Position: open upward when near bottom of viewport would be ideal,
          // but for this scaffold we open downward with a max-height scroll.
          className={[
            'absolute z-50 mt-1 min-w-[11rem] max-h-72 overflow-y-auto',
            'rounded-xl border border-gray-200 bg-white shadow-xl',
            // Scroll bar styling (webkit)
            'scrollbar-thin',
            // RTL — align to the correct edge automatically via logical properties.
            // In an LTR context `right-0` keeps the dropdown from overflowing right;
            // in RTL (ar) we flip to `left-0`. Using `end-0` (Tailwind logical) is
            // cleaner but requires Tailwind v3.3+; fall back to conditional class.
            document.documentElement.dir === 'rtl' ? 'left-0' : 'right-0',
            // Appear animation — skip for prefers-reduced-motion
            'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-100',
          ].join(' ')}
        >
          {LANGUAGES.map((lang, index) => {
            const isSelected = lang.code === activeLng.code;
            const isFocused = focusedIndex === index;

            return (
              <li
                key={lang.code}
                ref={(el) => { optionRefs.current[index] = el; }}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => selectLanguage(lang.code)}
                onKeyDown={(e) => handleOptionKeyDown(e, index)}
                className={[
                  'flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer select-none',
                  'outline-none', // outline suppressed; custom ring below
                  // Selected state
                  isSelected
                    ? 'bg-orange-50 text-orange-700 font-semibold'
                    : 'text-gray-700 hover:bg-gray-50',
                  // Keyboard-focus ring (isFocused mirrors DOM focus via useEffect)
                  isFocused
                    ? 'ring-2 ring-inset ring-orange-400'
                    : '',
                  // Motion
                  'motion-safe:transition-colors motion-safe:duration-100',
                ].join(' ')}
              >
                {/* Flag */}
                <span aria-hidden="true" className="text-base leading-none flex-shrink-0">
                  {lang.flag}
                </span>

                {/* Native label (primary) + English label (secondary) */}
                <span className="flex flex-col leading-tight min-w-0">
                  <span className="truncate">{lang.nativeLabel}</span>
                  {lang.nativeLabel !== lang.label && (
                    <span className="text-xs text-gray-400 truncate">{lang.label}</span>
                  )}
                </span>

                {/* Selected check mark */}
                {isSelected && (
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="ms-auto text-orange-500 flex-shrink-0"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default LanguageSwitcher;
