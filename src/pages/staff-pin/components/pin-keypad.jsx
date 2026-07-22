// pin-keypad.jsx — touch-friendly 3×4 PIN keypad (44 px+ tap targets).
// Props:
//   pin         string   current digit string
//   maxLength   number   max digits (default 6)
//   onDigit     fn(d)    called with '0'–'9'
//   onDelete    fn()     backspace
//   onClear     fn()     clear all
//   onSubmit    fn()     submit (fires when pin.length >= minLength, or via button)
//   minLength   number   (default 4)
//   loading     bool
//   error       string|null  shown below dots

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// eslint-disable-next-line react/prop-types
function KeyButton({ children, onClick, disabled, variant = 'digit' }) {
  const base =
    'flex items-center justify-center rounded-2xl text-xl font-semibold transition-all duration-100 select-none touch-manipulation';
  const variants = {
    digit:
      'w-[72px] h-[72px] bg-card border border-border shadow-sm hover:bg-muted active:scale-95 active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed sm:w-20 sm:h-20',
    action:
      'w-[72px] h-[72px] bg-muted border border-border shadow-sm hover:bg-muted/70 active:scale-95 active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed sm:w-20 sm:h-20',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // Minimum 44 px hit target enforced by inline style as a safety net
      style={{ minWidth: 44, minHeight: 44 }}
      className={`${base} ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

// eslint-disable-next-line react/prop-types
function PinDots({ length, maxLength }) {
  return (
    <div className="flex items-center justify-center gap-3 my-4" aria-label={`${length} of ${maxLength} digits entered`}>
      {Array.from({ length: maxLength }).map((_, i) => (
        <div
          key={i}
          className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
            i < length
              ? 'bg-primary border-primary scale-110'
              : 'bg-transparent border-border'
          }`}
        />
      ))}
    </div>
  );
}

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

// eslint-disable-next-line react/prop-types
const PinKeypad = ({ pin = '', maxLength = 6, minLength = 4, onDigit, onDelete, onClear, onSubmit, loading = false, error = null }) => {
  const canSubmit = pin.length >= minLength && !loading;

  return (
    <div className="flex flex-col items-center w-full">
      {/* Dot progress indicator */}
      <PinDots length={pin.length} maxLength={maxLength} />

      {error && (
        <p role="alert" className="text-xs text-destructive text-center mb-2 px-2">
          {error}
        </p>
      )}

      {/* Numpad grid — 3 × 3 digit rows + bottom action row */}
      <div className="flex flex-col items-center gap-2.5 mt-1">
        {ROWS.map((row) => (
          <div key={row.join('')} className="flex gap-2.5">
            {row.map((d) => (
              <KeyButton key={d} onClick={() => onDigit(d)} disabled={loading || pin.length >= maxLength}>
                {d}
              </KeyButton>
            ))}
          </div>
        ))}

        {/* Bottom row: CLR | 0 | ⌫ */}
        <div className="flex gap-2.5">
          <KeyButton variant="action" onClick={onClear} disabled={loading || pin.length === 0}>
            <span className="text-sm font-medium text-muted-foreground">CLR</span>
          </KeyButton>
          <KeyButton onClick={() => onDigit('0')} disabled={loading || pin.length >= maxLength}>
            0
          </KeyButton>
          <KeyButton variant="action" onClick={onDelete} disabled={loading || pin.length === 0}>
            <span className="text-lg">⌫</span>
          </KeyButton>
        </div>
      </div>

      {/* Submit button */}
      <Button
        type="button"
        className="w-full max-w-[244px] sm:max-w-[268px] h-12 mt-5 font-semibold shadow-lg transition-all duration-200 text-base"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Signing in...
          </span>
        ) : (
          'Sign In'
        )}
      </Button>
    </div>
  );
};

export default PinKeypad;
