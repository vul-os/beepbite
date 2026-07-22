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
          ? 'bg-success/10 border-success/25'
          : 'bg-muted border-border'
      }`}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      ) : isOnline ? (
        <Wifi className="w-5 h-5 text-success" />
      ) : (
        <WifiOff className="w-5 h-5 text-muted-foreground" />
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isOnline ? 'text-success' : 'text-foreground'}`}>
          {isOnline ? 'Online — accepting deliveries' : 'Offline'}
        </p>
        <p className="text-xs text-muted-foreground/80 leading-tight">
          {isOnline
            ? 'Your location is being shared while on a delivery.'
            : 'Toggle on to start receiving delivery requests.'}
        </p>
      </div>

      <Switch
        checked={isOnline}
        onCheckedChange={onChange}
        disabled={loading}
        className="data-[state=checked]:bg-success"
      />
    </div>
  );
}
