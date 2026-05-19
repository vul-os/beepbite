// coverage-card.jsx — allergen & dietary tag coverage stats across menu items.

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Leaf } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function CoverageCard({ allItems, itemAllergens, itemDietaryTags, loading }) {
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const total = allItems.length;
    if (total === 0) return { total: 0, allergenPct: 0, dietaryPct: 0 };

    const withAllergen = new Set(itemAllergens.map(r => r.item_id)).size;
    const withDietary = new Set(itemDietaryTags.map(r => r.item_id)).size;

    return {
      total,
      allergenPct: Math.round((withAllergen / total) * 100),
      dietaryPct: Math.round((withDietary / total) * 100),
      withAllergen,
      withDietary,
    };
  }, [allItems, itemAllergens, itemDietaryTags]);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-teal-500" />
          Allergen & Dietary Coverage
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 space-y-5">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : stats.total === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No active menu items found</p>
        ) : (
          <>
            {/* Allergen coverage */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-teal-500" />
                  <span className="text-sm font-medium">Allergen data</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {stats.allergenPct}%
                  <span className="text-xs text-muted-foreground font-normal ml-1">
                    ({stats.withAllergen}/{stats.total})
                  </span>
                </span>
              </div>
              <Progress value={stats.allergenPct} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {stats.total - stats.withAllergen} item{stats.total - stats.withAllergen !== 1 ? 's' : ''} missing allergen info
              </p>
            </div>

            {/* Dietary tag coverage */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Leaf className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-sm font-medium">Dietary tags</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {stats.dietaryPct}%
                  <span className="text-xs text-muted-foreground font-normal ml-1">
                    ({stats.withDietary}/{stats.total})
                  </span>
                </span>
              </div>
              <Progress value={stats.dietaryPct} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {stats.total - stats.withDietary} item{stats.total - stats.withDietary !== 1 ? 's' : ''} missing dietary tags
              </p>
            </div>
          </>
        )}
      </CardContent>

      <CardFooter className="pt-3 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1 text-xs"
          onClick={() => navigate('/menu')}
        >
          Manage items <ArrowRight className="h-3 w-3" />
        </Button>
      </CardFooter>
    </Card>
  );
}
