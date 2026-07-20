import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DenominationGrid } from './denomination-grid';
import { api } from '@/lib/api-client';
import { useMoney } from '@/context/locale-context';
import { Loader2, Unlock } from 'lucide-react';

/**
 * OpenSessionForm
 *
 * Props:
 *   drawerId: string
 *   staffId: string         — currently logged-in staff id (used as opened_by_staff_id)
 *   onOpened: (session) => void
 *
 * Requires LocaleProvider above it.
 */
export function OpenSessionForm({ drawerId, staffId, onOpened }) {
  const { format, parse, symbol, scale, decimals } = useMoney();
  const [floatMajor, setFloatMajor] = useState('');
  const [denomCounts, setDenomCounts] = useState({});
  const [denomTotalCents, setDenomTotalCents] = useState(0);
  const [useFloat, setUseFloat] = useState('manual'); // 'manual' | 'denominations'
  const [isBlindClose, setIsBlindClose] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleDenomChange = (counts, totalCents) => {
    setDenomCounts(counts);
    setDenomTotalCents(totalCents);
    if (useFloat === 'denominations') {
      // Raw major-unit digits, not format(): this feeds a type="number" input,
      // which rejects grouping marks and currency symbols.
      setFloatMajor((totalCents / scale).toFixed(decimals));
    }
  };

  const openingFloatCents =
    useFloat === 'denominations'
      ? denomTotalCents
      : parse(floatMajor) ?? 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!drawerId) { setError('No drawer selected'); return; }
    if (openingFloatCents < 0) { setError('Opening float must be zero or positive'); return; }

    setSubmitting(true);
    try {
      const { data, error: apiErr } = await api.request(
        'POST',
        `/cash-drawers/${drawerId}/sessions/open`,
        {
          body: {
            opening_float_cents: openingFloatCents,
            opened_by_staff_id: staffId || '',
            is_blind_close: isBlindClose,
            denominations: denomCounts,
          },
        },
      );
      if (apiErr) throw new Error(apiErr.message);
      onOpened?.(data);
    } catch (err) {
      setError(err.message || 'Failed to open session');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Unlock className="h-5 w-5 text-orange-500" />
          Open Cash Drawer Session
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Float entry method toggle */}
          <div className="flex gap-3">
            <Button
              type="button"
              variant={useFloat === 'manual' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setUseFloat('manual')}
            >
              Enter amount
            </Button>
            <Button
              type="button"
              variant={useFloat === 'denominations' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setUseFloat('denominations')}
            >
              Count denominations
            </Button>
          </div>

          {useFloat === 'manual' ? (
            <div className="space-y-1">
              <Label htmlFor="opening-float">Opening float ({symbol})</Label>
              <Input
                id="opening-float"
                type="number"
                min="0"
                // One minor unit. A fixed 0.01 makes a JPY till reject ¥1.
                step={(1 / scale).toFixed(decimals)}
                placeholder={(0).toFixed(decimals)}
                value={floatMajor}
                onChange={(e) => setFloatMajor(e.target.value)}
                className="max-w-xs"
                required
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Count opening float by denomination</Label>
              <DenominationGrid
                counts={denomCounts}
                onChange={handleDenomChange}
              />
            </div>
          )}

          {/* Blind-close toggle */}
          <div className="flex items-center gap-3">
            <input
              id="blind-close"
              type="checkbox"
              checked={isBlindClose}
              onChange={(e) => setIsBlindClose(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
            />
            <Label htmlFor="blind-close" className="cursor-pointer">
              Blind close — staff won&apos;t see the expected balance at closing
            </Label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <span className="text-sm text-muted-foreground">Opening float:</span>
            <span className="font-semibold">{format(openingFloatCents)}</span>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Open Session
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
