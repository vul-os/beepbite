import { useState, useCallback } from 'react';
import { X, Banknote, CreditCard, CheckCircle2, Loader2, Delete } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/currency';

// Common cash denomination sets per currency
const CASH_DENOMINATIONS = {
  ZAR: [10, 20, 50, 100, 200],
  USD: [1, 5, 10, 20, 50, 100],
  NGN: [100, 200, 500, 1000],
  KES: [50, 100, 200, 500, 1000],
  GHS: [1, 2, 5, 10, 20, 50],
  EUR: [5, 10, 20, 50, 100],
  GBP: [5, 10, 20, 50],
};

const NUMPAD = ['7','8','9','4','5','6','1','2','3','0','00',null];

const KioskTenderModal = ({ total, currency, onClose, onConfirm, loading, error, lastOrderNumber }) => {
  const [method, setMethod] = useState(null); // 'cash' | 'card'
  const [cashEntry, setCashEntry] = useState('');

  const totalCents = Math.round(total * 100);
  const denoms = CASH_DENOMINATIONS[currency] || CASH_DENOMINATIONS.USD;

  const cashAmount = parseFloat(cashEntry) || 0;
  const changeCents = Math.round(cashAmount * 100) - totalCents;

  const handleNumpad = useCallback((key) => {
    if (key === null) return; // backspace tile (we handle via Delete key)
    setCashEntry(prev => {
      // Prevent more than 2 decimal places
      if (prev.includes('.') && prev.split('.')[1]?.length >= 2) return prev;
      if (key === '.' && prev.includes('.')) return prev;
      // Prevent leading zeros for whole part
      if (!prev && key === '0') return '0';
      if (prev === '0' && key !== '.') return key;
      return prev + key;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setCashEntry(prev => prev.slice(0, -1));
  }, []);

  const handleDenom = useCallback((d) => {
    setCashEntry(String(d));
  }, []);

  const canConfirmCash = method === 'cash' && cashAmount * 100 >= totalCents - 0.5;
  const canConfirmCard = method === 'card';

  const handleConfirm = () => {
    if (!method) return;
    onConfirm({
      method,
      cashTendered: method === 'cash' ? Math.round(cashAmount * 100) : null,
    });
  };

  // Success state
  if (lastOrderNumber) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-10 flex flex-col items-center gap-4 max-w-sm w-full animate-in zoom-in-95 duration-200">
          <CheckCircle2 className="w-20 h-20 text-green-500" />
          <h2 className="text-3xl font-bold text-gray-900">Order Placed!</h2>
          <p className="text-xl text-gray-600 font-medium">#{lastOrderNumber}</p>
          <button
            onClick={onClose}
            className="mt-2 w-full h-14 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xl font-bold shadow-md transition-colors"
          >
            New Order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-[95vh] overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900">Tender</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Total */}
        <div className="px-6 py-4 bg-orange-50 border-b border-orange-100">
          <div className="flex justify-between items-baseline">
            <span className="text-gray-600 text-lg">Total due</span>
            <span className="text-4xl font-extrabold text-orange-600 tabular-nums">
              {formatPrice(totalCents, currency)}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Method selector */}
          <div className="grid grid-cols-2 gap-3" role="group" aria-label="Select payment method">
            <button
              onClick={() => setMethod('cash')}
              aria-pressed={method === 'cash'}
              aria-label="Pay with cash"
              className={cn(
                'h-16 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 font-semibold text-base transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                method === 'cash'
                  ? 'border-orange-500 bg-orange-500 text-white shadow-md scale-[1.02]'
                  : 'border-gray-200 text-gray-700 hover:border-orange-300 hover:bg-orange-50 active:bg-orange-100'
              )}
            >
              <Banknote className="w-6 h-6" aria-hidden="true" />
              Cash
            </button>
            <button
              onClick={() => { setMethod('card'); setCashEntry(''); }}
              aria-pressed={method === 'card'}
              aria-label="Pay with card"
              className={cn(
                'h-16 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 font-semibold text-base transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                method === 'card'
                  ? 'border-orange-500 bg-orange-500 text-white shadow-md scale-[1.02]'
                  : 'border-gray-200 text-gray-700 hover:border-orange-300 hover:bg-orange-50 active:bg-orange-100'
              )}
            >
              <CreditCard className="w-6 h-6" aria-hidden="true" />
              Card
            </button>
          </div>

          {/* Cash calculator */}
          {method === 'cash' && (
            <div className="space-y-3">
              {/* Denomination quick-select */}
              <div className="flex flex-wrap gap-2">
                {denoms.map(d => (
                  <button
                    key={d}
                    onClick={() => handleDenom(d)}
                    className={cn(
                      'h-11 px-4 rounded-xl border-2 text-base font-semibold transition-colors',
                      cashAmount === d
                        ? 'border-orange-500 bg-orange-500 text-white'
                        : 'border-gray-200 text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                    )}
                  >
                    {formatPrice(d * 100, currency)}
                  </button>
                ))}
              </div>

              {/* Cash entry display */}
              <div className="flex items-center justify-between bg-gray-50 rounded-2xl px-4 py-3 border-2 border-gray-200">
                <span className="text-gray-500 text-lg">Tendered</span>
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold tabular-nums text-gray-900">
                    {cashEntry ? formatPrice(Math.round(parseFloat(cashEntry || '0') * 100), currency) : '—'}
                  </span>
                  {cashEntry && (
                    <button onClick={handleBackspace} className="p-1 text-gray-400 hover:text-gray-600">
                      <Delete className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-2">
                {NUMPAD.map((key, i) => (
                  key === null ? (
                    <button
                      key={i}
                      onClick={handleBackspace}
                      className="h-14 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition-colors"
                    >
                      <Delete className="w-5 h-5 text-gray-600" />
                    </button>
                  ) : (
                    <button
                      key={i}
                      onClick={() => handleNumpad(key)}
                      className="h-14 rounded-xl bg-gray-100 text-xl font-bold text-gray-900 hover:bg-orange-100 active:bg-orange-200 transition-colors"
                    >
                      {key}
                    </button>
                  )
                ))}
                {/* Decimal */}
                <button
                  onClick={() => handleNumpad('.')}
                  className="h-14 rounded-xl bg-gray-100 text-xl font-bold text-gray-900 hover:bg-orange-100 active:bg-orange-200 transition-colors"
                >
                  .
                </button>
              </div>

              {/* Change due */}
              {canConfirmCash && changeCents > 0 && (
                <div className="flex justify-between items-baseline bg-green-50 rounded-xl px-4 py-3 border border-green-200">
                  <span className="text-green-700 font-medium">Change due</span>
                  <span className="text-2xl font-bold text-green-700 tabular-nums">
                    {formatPrice(changeCents, currency)}
                  </span>
                </div>
              )}
            </div>
          )}

          {method === 'card' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CreditCard className="w-16 h-16 text-orange-300" />
              <p className="text-gray-600 text-lg text-center">
                Present card to reader, then tap Confirm.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
            >
              <span className="mt-0.5 shrink-0 text-red-500" aria-hidden="true">⚠</span>
              <span className="font-medium">{error}</span>
            </div>
          )}
        </div>

        {/* Confirm button */}
        <div className="px-6 pb-safe pb-6 pt-2 shrink-0">
          <button
            onClick={handleConfirm}
            disabled={loading || (!canConfirmCash && !canConfirmCard)}
            aria-label={loading ? 'Placing order' : 'Confirm and send to kitchen'}
            aria-busy={loading}
            className={cn(
              'w-full h-16 rounded-2xl text-xl font-bold shadow-md transition-all flex items-center justify-center gap-2',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-400 focus-visible:ring-offset-2',
              (canConfirmCash || canConfirmCard) && !loading
                ? 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed',
            )}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
                Placing order…
              </span>
            ) : (
              'Confirm & Send to Kitchen'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KioskTenderModal;
