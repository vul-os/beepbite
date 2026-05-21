// src/components/cookie-consent.jsx
//
// EU-style granular cookie consent banner.
// - Three consent categories: necessary (always on), analytics, marketing.
// - Persists choices to localStorage under key 'bb.cookie-consent'.
// - Fully accessible: focus-trapped in expanded view, keyboard-navigable,
//   ARIA roles, labelled inputs, reduced-motion respecting.
// - Self-contained: no external icon dependencies.
//
// Usage:
//   import CookieConsent from '@/components/cookie-consent';
//   // Render once near the app root, outside any auth gate:
//   <CookieConsent />
//
// Reading consent elsewhere in the app:
//   import { readCookieConsent } from '@/components/cookie-consent';
//   const { analytics, marketing } = readCookieConsent();
//
import React from 'react';

const STORAGE_KEY = 'bb.cookie-consent';

/**
 * Read the stored consent object.
 * @returns {{ necessary: true, analytics: boolean, marketing: boolean } | null}
 *   null if the user has not yet responded.
 */
export function readCookieConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Guard: always normalise necessary to true.
    return { necessary: true, analytics: !!parsed.analytics, marketing: !!parsed.marketing };
  } catch {
    return null;
  }
}

function writeConsent(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ necessary: true, ...prefs }));
  } catch {
    // localStorage unavailable — silent fail.
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CookieConsent = () => {
  const [visible, setVisible] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [prefs, setPrefs] = React.useState({ analytics: false, marketing: false });
  const bannerRef = React.useRef(null);

  // Show banner only when no prior consent exists.
  React.useEffect(() => {
    const stored = readCookieConsent();
    if (!stored) {
      setVisible(true);
    }
  }, []);

  // Trap focus inside the expanded panel for keyboard accessibility.
  React.useEffect(() => {
    if (!expanded || !bannerRef.current) return;
    const focusable = bannerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    first?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  const acceptAll = () => {
    const choice = { analytics: true, marketing: true };
    writeConsent(choice);
    setVisible(false);
  };

  const acceptNecessary = () => {
    const choice = { analytics: false, marketing: false };
    writeConsent(choice);
    setVisible(false);
  };

  const savePreferences = () => {
    writeConsent(prefs);
    setVisible(false);
  };

  const togglePref = (key) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  };

  if (!visible) return null;

  return (
    <>
      {/* Backdrop when expanded */}
      {expanded && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
            zIndex: 9998,
            animation: 'cc-fade-in 0.2s ease',
          }}
          onClick={() => setExpanded(false)}
        />
      )}

      <div
        ref={bannerRef}
        role="dialog"
        aria-modal={expanded ? 'true' : undefined}
        aria-label="Cookie preferences"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          padding: '1rem',
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: '12px 12px 0 0',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
            maxWidth: '680px',
            width: '100%',
            padding: '1.25rem 1.5rem',
            pointerEvents: 'auto',
            animation: 'cc-slide-up 0.3s cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            {/* Cookie icon */}
            <span aria-hidden="true" style={{ fontSize: '1.5rem', lineHeight: 1 }}>&#127850;</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 0.4rem', fontWeight: 700, fontSize: '0.95rem', color: '#1a1a2e' }}>
                We use cookies &amp; local storage
              </p>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#555', lineHeight: 1.5 }}>
                We use local storage to remember your session and preferences.
                Analytics helps us improve. Marketing is optional.{' '}
                <a
                  href="/legal/privacy"
                  style={{ color: '#e67e22', textDecoration: 'underline' }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>

          {/* Expanded preferences panel */}
          {expanded && (
            <div
              style={{
                marginTop: '1rem',
                borderTop: '1px solid #eee',
                paddingTop: '1rem',
              }}
            >
              <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                <legend
                  style={{ fontSize: '0.82rem', fontWeight: 600, color: '#333', marginBottom: '0.75rem' }}
                >
                  Manage cookie preferences
                </legend>

                {/* Necessary — always on, disabled */}
                <ConsentRow
                  id="cc-necessary"
                  label="Necessary"
                  description="Session management, authentication, cart and consent storage. Cannot be disabled."
                  checked={true}
                  disabled
                />

                {/* Analytics */}
                <ConsentRow
                  id="cc-analytics"
                  label="Analytics"
                  description="Helps us understand how users interact with the app so we can improve it. No personal data is sold."
                  checked={prefs.analytics}
                  onChange={() => togglePref('analytics')}
                />

                {/* Marketing */}
                <ConsentRow
                  id="cc-marketing"
                  label="Marketing"
                  description="Allows us to personalise promotions and relevant product suggestions."
                  checked={prefs.marketing}
                  onChange={() => togglePref('marketing')}
                />
              </fieldset>
            </div>
          )}

          {/* Action buttons */}
          <div
            style={{
              marginTop: '1rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            <button
              onClick={acceptAll}
              style={btnStyle('primary')}
            >
              Accept all
            </button>

            {expanded ? (
              <button onClick={savePreferences} style={btnStyle('secondary')}>
                Save preferences
              </button>
            ) : (
              <button
                onClick={() => setExpanded(true)}
                aria-expanded="false"
                style={btnStyle('secondary')}
              >
                Manage preferences
              </button>
            )}

            <button
              onClick={acceptNecessary}
              style={btnStyle('ghost')}
            >
              Necessary only
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          [style*="animation"] { animation: none !important; }
        }
        @keyframes cc-slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes cc-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
};

// ---------------------------------------------------------------------------
// ConsentRow — accessible toggle row
// ---------------------------------------------------------------------------

const ConsentRow = ({ id, label, description, checked, disabled, onChange }) => (
  <label
    htmlFor={id}
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.75rem',
      marginBottom: '0.75rem',
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    {/* Toggle */}
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        width: '2.4rem',
        height: '1.4rem',
        flexShrink: 0,
        marginTop: '0.1rem',
      }}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          opacity: 0,
          margin: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          zIndex: 1,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '999px',
          background: checked ? (disabled ? '#a8d5a2' : '#e67e22') : '#ddd',
          transition: 'background 0.2s',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '3px',
          left: checked ? 'calc(100% - 1.1rem)' : '3px',
          width: '1rem',
          height: '1rem',
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.2s',
        }}
      />
    </span>

    {/* Text */}
    <span>
      <span style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: '#1a1a2e' }}>
        {label}
        {disabled && (
          <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: '#888', fontWeight: 400 }}>
            (always active)
          </span>
        )}
      </span>
      <span style={{ display: 'block', fontSize: '0.78rem', color: '#777', lineHeight: 1.45 }}>
        {description}
      </span>
    </span>
  </label>
);

// ---------------------------------------------------------------------------
// Button style helper
// ---------------------------------------------------------------------------

function btnStyle(variant) {
  const base = {
    padding: '0.5rem 1.1rem',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    transition: 'background 0.15s, opacity 0.15s',
    lineHeight: 1.4,
  };
  if (variant === 'primary') {
    return { ...base, background: 'linear-gradient(135deg,#e67e22,#e84393)', color: '#fff' };
  }
  if (variant === 'secondary') {
    return { ...base, background: '#f5f5f5', color: '#333', border: '1px solid #ddd' };
  }
  // ghost
  return { ...base, background: 'none', color: '#888', textDecoration: 'underline', padding: '0.5rem 0.6rem' };
}

export default CookieConsent;
