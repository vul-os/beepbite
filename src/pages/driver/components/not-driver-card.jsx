import { Truck, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shown when GET /driver/assignments returns empty or 403 — user is not a
 * driver at any restaurant yet.
 *
 * Props:
 *   userEmail {string|undefined}
 */
export default function NotDriverCard({ userEmail }) {
  return (
    <Card className="border border-orange-100 shadow-sm">
      <CardContent className="p-6 flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
          <Truck className="w-8 h-8 text-orange-500" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-bold text-gray-900">
            You&apos;re not set up as a driver yet
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed max-w-xs mx-auto">
            Ask the restaurant that hired you to invite you as a driver using
            the email address you signed up with.
          </p>
        </div>

        {userEmail && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm">
            <Mail className="w-4 h-4 text-orange-500 flex-shrink-0" />
            <span className="font-mono text-orange-700 break-all">{userEmail}</span>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Once invited, your delivery assignments will appear here.
        </p>
      </CardContent>
    </Card>
  );
}
