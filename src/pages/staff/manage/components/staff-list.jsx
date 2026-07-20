import React, { useState } from 'react';
import { Search, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getRoleColor } from '@/lib/role-colors';

function getInitials(first, last) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

export function StaffList({ staffList, loading, selectedStaff, onSelect }) {
  const [query, setQuery] = useState('');

  const filtered = staffList.filter((m) => {
    const q = query.toLowerCase();
    return (
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      (m.username ?? '').toLowerCase().includes(q) ||
      (m.role ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <aside className="flex flex-col h-full border-r border-border bg-card">
      {/* search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9 text-sm border-border focus:border-orange-300 focus:ring-orange-200"
            placeholder="Search staff…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 space-y-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <User className="w-8 h-8 mb-2" />
            <p className="text-sm">{query ? 'No match' : 'No staff members'}</p>
          </div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {filtered.map((m) => {
              const active = selectedStaff?.id === m.id;
              return (
                <li key={m.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onSelect(m)}
                    className={cn(
                      'w-full h-auto flex items-center justify-start gap-3 px-3 py-2.5 rounded-lg text-left font-normal',
                      active
                        ? 'bg-orange-50 text-orange-900 hover:bg-orange-50 hover:text-orange-900'
                        : 'text-foreground',
                    )}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback
                        className={cn(
                          'text-xs font-semibold',
                          active ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {getInitials(m.first_name, m.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.first_name} {m.last_name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px] px-1.5 py-0 capitalize', getRoleColor(m.role))}
                        >
                          {m.role}
                        </Badge>
                        {!m.is_active && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border-red-200"
                          >
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
