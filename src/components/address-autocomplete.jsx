import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, MapPin } from 'lucide-react';
import { suggestAddress } from '@/services/geocode';

// AddressAutocomplete — a controlled, debounced search-as-you-type address
// field backed by the backend geocode proxy (South-Africa biased).
//
// It degrades gracefully: if the proxy returns nothing the field still works as
// a plain text input, so manual entry is always possible.
//
// Props:
//   value      string                  — current text (controlled)
//   onChange   (text: string) => void  — fired on every keystroke (raw text)
//   onSelect   (s) => void             — fired when a suggestion is chosen;
//                                         s = { place_name, street, suburb,
//                                               city, postcode, lat, lng }
//   ...rest    spread onto the <Input> (id, placeholder, required, className…)
//
// Accessibility: implements the ARIA combobox pattern (role=combobox + listbox,
// aria-expanded, aria-activedescendant, arrow-key nav, Enter to select, Esc to
// close, click-outside to close).

const DEBOUNCE_MS = 250;
const MIN_CHARS = 3;

export default function AddressAutocomplete({
  value = '',
  onChange,
  onSelect,
  className,
  id,
  placeholder = 'Start typing your address…',
  ...rest
}) {
  const reactId = useId();
  const baseId = id || `addr-${reactId}`;
  const listboxId = `${baseId}-listbox`;

  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // True once a query has returned with no matches — drives the "no matches" row.
  const [searched, setSearched] = useState(false);

  const rootRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);
  // When we programmatically set the text after a selection we don't want the
  // change to immediately re-trigger a search.
  const skipNextSearchRef = useRef(false);

  // ── Debounced query ───────────────────────────────────────────────────────
  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    const q = (value || '').trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < MIN_CHARS) {
      setSuggestions([]);
      setLoading(false);
      setSearched(false);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      const results = await suggestAddress(q);
      // Ignore stale responses (a newer keystroke superseded this request).
      if (myReq !== reqIdRef.current) return;
      setSuggestions(results);
      setSearched(true);
      setLoading(false);
      setOpen(true);
      setActiveIndex(-1);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  // ── Click-outside to close ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  const choose = useCallback(
    (s) => {
      if (!s) return;
      skipNextSearchRef.current = true;
      onChange?.(s.street || s.place_name || '');
      onSelect?.(s);
      setOpen(false);
      setActiveIndex(-1);
      setSuggestions([]);
      setSearched(false);
    },
    [onChange, onSelect],
  );

  const handleKeyDown = (e) => {
    const showingList = open && suggestions.length > 0;
    switch (e.key) {
      case 'ArrowDown':
        if (!open) { setOpen(true); return; }
        if (!showingList) return;
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        if (!showingList) return;
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        break;
      case 'Enter':
        if (showingList && activeIndex >= 0) {
          e.preventDefault();
          choose(suggestions[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
      default:
        break;
    }
  };

  const showDropdown = open && (loading || suggestions.length > 0 || searched);
  const activeOptionId =
    activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <Input
        {...rest}
        id={baseId}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0 || searched) setOpen(true);
        }}
        className={className}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
      />

      {loading && (
        <Loader2
          className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-orange-400"
          aria-hidden="true"
        />
      )}

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-border bg-popover shadow-lg py-1 text-sm"
        >
          {suggestions.length === 0 && !loading && searched && (
            <li
              role="option"
              aria-disabled="true"
              aria-selected="false"
              className="px-3 py-2.5 text-muted-foreground"
            >
              No matches — keep typing or enter the address manually.
            </li>
          )}

          {suggestions.map((s, i) => {
            const isActive = i === activeIndex;
            return (
              <li
                key={`${s.place_name || s.street || 'opt'}-${i}`}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActiveIndex(i)}
                // Use onMouseDown so selection fires before the input blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer ${
                  isActive ? 'bg-orange-50 text-orange-900' : 'hover:bg-muted'
                }`}
              >
                <MapPin
                  className={`h-4 w-4 mt-0.5 shrink-0 ${
                    isActive ? 'text-orange-500' : 'text-muted-foreground'
                  }`}
                  aria-hidden="true"
                />
                <span className="leading-snug">
                  <span className="font-medium">
                    {s.street || s.place_name}
                  </span>
                  {(s.suburb || s.city) && (
                    <span className="block text-xs text-muted-foreground">
                      {[s.suburb, s.city, s.postcode].filter(Boolean).join(', ')}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
