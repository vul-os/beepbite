import React from 'react';
import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

/**
 * Online / offline shift toggle.
 *
 * Props:
 *   isOnline   {boolean}  — current shift state
 *   loading    {boolean}  — API call in-flight
 *   onChange   {(bool) => void}
 */
export default function ShiftToggle({ isOnline, loading, onChange }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 border transition-colors ${
        isOnline
          ? 'bg-green-50 border-green-200'
          : 'bg-gray-50 border-gray-200'
      }`}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
      ) : isOnline ? (
        <Wifi className="w-5 h-5 text-green-600" />
      ) : (
        <WifiOff className="w-5 h-5 text-gray-400" />
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isOnline ? 'text-green-700' : 'text-gray-600'}`}>
          {isOnline ? 'Online — accepting deliveries' : 'Offline'}
        </p>
        <p className="text-xs text-gray-400 leading-tight">
          {isOnline
            ? 'Your location is being shared while on a delivery.'
            : 'Toggle on to start receiving delivery requests.'}
        </p>
      </div>

      <Switch
        checked={isOnline}
        onCheckedChange={onChange}
        disabled={loading}
        className="data-[state=checked]:bg-green-500"
      />
    </div>
  );
}
