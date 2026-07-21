// audit-log-card.jsx — last 20 audit_log entries for the location.

import { ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const ACTOR_COLORS = {
  member: 'bg-blue-100 text-blue-800',
  staff: 'bg-purple-100 text-purple-800',
  system: 'bg-gray-100 text-gray-700',
  customer: 'bg-yellow-100 text-yellow-800',
  webhook: 'bg-orange-100 text-orange-800',
};

function formatRelativeTime(iso) {
  if (!iso) return '';
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AuditLogCard({ entries, loading }) {
  return (
    <Card className="flex flex-col col-span-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-gray-500" />
          Recent Activity
        </CardTitle>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Actor</th>
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 font-medium text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${ACTOR_COLORS[entry.actor_type] || 'bg-gray-100 text-gray-700'}`}
                        >
                          {entry.actor_type}
                        </span>
                        {entry.actor_label && (
                          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                            {entry.actor_label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      <code className="text-xs bg-muted rounded px-1 py-0.5">{entry.action}</code>
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {entry.entity_type}
                      {entry.reason && (
                        <span className="ml-1 text-gray-400">— {entry.reason}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground text-right whitespace-nowrap">
                      {formatRelativeTime(entry.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
