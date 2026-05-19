// section-tabs.jsx — horizontal tab bar for switching between floor sections.
// Uses shadcn Tabs primitives. The "all" option is always pinned at the front.

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

export default function SectionTabs({
  sections = [],
  value,
  onValueChange,
  counts = {},
  showAll = true,
}) {
  return (
    <Tabs value={value || 'all'} onValueChange={onValueChange}>
      <TabsList className="flex flex-wrap gap-1">
        {showAll && (
          <TabsTrigger value="all" className="flex items-center gap-2">
            All
            {typeof counts.all === 'number' && (
              <Badge variant="secondary" className="text-xs">{counts.all}</Badge>
            )}
          </TabsTrigger>
        )}
        {sections.map((s) => (
          <TabsTrigger key={s.id} value={s.id} className="flex items-center gap-2">
            {s.name}
            {typeof counts[s.id] === 'number' && (
              <Badge variant="secondary" className="text-xs">{counts[s.id]}</Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
