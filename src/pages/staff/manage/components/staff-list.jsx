import React, { useState } from 'react';
import { Search, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function getInitials(first, last) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

const ROLE_COLORS = {
  owner:   'bg-orange-100 text-orange-800 border-orange-200',
  admin:   'bg-purple-100 text-purple-800 border-purple-200',
  manager: 'bg-blue-100 text-blue-800 border-blue-200',
  cashier: 'bg-green-100 text-green-800 border-green-200',
  kitchen: 'bg-gray-100 text-gray-700 border-gray-200',
};

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
    <aside className="flex flex-col h-full border-r border-gray-100 bg-white">
      {/* search */}
      <div className="p-3 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            className="pl-9 h-9 text-sm border-gray-200 focus:border-orange-300 focus:ring-orange-200"
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
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <User className="w-8 h-8 mb-2" />
            <p className="text-sm">{query ? 'No match' : 'No staff members'}</p>
          </div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {filtered.map((m) => {
              const active = selectedStaff?.id === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      active
                        ? 'bg-orange-50 text-orange-900'
                        : 'hover:bg-gray-50 text-gray-800',
                    )}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback
                        className={cn(
                          'text-xs font-semibold',
                          active ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600',
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
                          className={cn(
                            'text-[10px] px-1.5 py-0 capitalize',
                            ROLE_COLORS[m.role] ?? 'bg-gray-50 text-gray-600 border-gray-200',
                          )}
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
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
