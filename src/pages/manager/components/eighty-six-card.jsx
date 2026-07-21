// eighty-six-card.jsx — items currently 86'd (is_86ed = true).

import { useNavigate } from 'react-router-dom';
import { Ban, ArrowRight, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// Determine whether the 86 was auto (inventory) or manual.
function reason86(item) {
  if (item.auto_86_when_inventory_empty) return 'Low inventory';
  if (item.available_until) {
    const until = new Date(item.available_until);
    if (until > new Date()) return `Until ${until.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  return 'Manual';
}

export default function EightySixCard({ items, loading }) {
  const navigate = useNavigate();

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ban className="h-4 w-4 text-red-500" />
          86'd Items
          {!loading && items.length > 0 && (
            <Badge variant="destructive" className="ml-auto text-xs">
              {items.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 min-h-0">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-muted-foreground gap-1">
            <AlertTriangle className="h-8 w-8 text-green-400" />
            <p className="text-sm font-medium text-green-700">All items available</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {items.map(item => (
              <li
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2 gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red-900 truncate">{item.name}</p>
                  {item.short_description && (
                    <p className="text-xs text-red-700 truncate">{item.short_description}</p>
                  )}
                </div>
                <Badge variant="outline" className="text-xs shrink-0 border-red-300 text-red-700">
                  {reason86(item)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooter className="pt-3 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1 text-xs"
          onClick={() => navigate('/menu')}
        >
          Edit menu <ArrowRight className="h-3 w-3" />
        </Button>
      </CardFooter>
    </Card>
  );
}
