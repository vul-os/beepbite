// promotions-card.jsx — active promotions summary for the manager dashboard.

import { useNavigate } from 'react-router-dom';
import { ArrowRight, Megaphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const PROMO_TYPE_LABELS = {
  percent_off: 'Percent off',
  fixed_off: 'Fixed off',
  bogo: 'BOGO',
  free_item: 'Free item',
  happy_hour_price: 'Happy-hour price',
  free_delivery: 'Free delivery',
};

const SCOPE_LABELS = {
  order: 'Order',
  item: 'Item',
  category: 'Category',
  delivery: 'Delivery',
};

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PromotionsCard({ promotions, loading }) {
  const navigate = useNavigate();

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4 text-orange-500" />
          Active Promotions
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 min-h-0">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : promotions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No active promotions</p>
        ) : (
          <ul className="space-y-2">
            {promotions.map(p => (
              <li key={p.id} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="secondary" className="text-xs">
                      {PROMO_TYPE_LABELS[p.promo_type] || p.promo_type}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {SCOPE_LABELS[p.scope] || p.scope}
                    </Badge>
                    {p.location_id == null && (
                      <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                        Org-wide
                      </Badge>
                    )}
                  </div>
                </div>
                {p.active_until && (
                  <p className="text-xs text-muted-foreground shrink-0 mt-0.5">
                    Ends {formatDate(p.active_until)}
                  </p>
                )}
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
          onClick={() => navigate('/settings/promotions')}
        >
          Manage promotions <ArrowRight className="h-3 w-3" />
        </Button>
      </CardFooter>
    </Card>
  );
}
