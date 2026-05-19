// schedule-card.jsx — shows which daypart schedules are currently in effect.
// Compares local time + ISO day-of-week against menu_schedule_slots windows.

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, ArrowRight, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// Returns ISO day-of-week 1 (Mon) – 7 (Sun) for "now" in local time.
function isoDay() {
  const d = new Date().getDay(); // 0=Sun … 6=Sat
  return d === 0 ? 7 : d;
}

// Returns 'HH:MM' string from a JS Date in local time.
function localHHMM(date = new Date()) {
  return date.toTimeString().slice(0, 5);
}

// Returns true if the slot [start_time, end_time] covers `nowHHMM`.
// Handles overnight windows (end < start).
function slotActive(start, end, now) {
  if (start <= end) {
    return now >= start && now < end;
  }
  // overnight: active if now >= start OR now < end
  return now >= start || now < end;
}

export default function ScheduleCard({ schedules, loading }) {
  const navigate = useNavigate();

  const { active, inactive } = useMemo(() => {
    const now = localHHMM();
    const day = isoDay();
    const active = [];
    const inactive = [];

    for (const s of schedules) {
      const slots = s.slots || [];
      const todaySlots = slots.filter(sl => sl.day_of_week === day);
      const isNow = todaySlots.some(sl => slotActive(sl.start_time, sl.end_time, now));
      if (isNow) {
        active.push({ ...s, todaySlots });
      } else {
        inactive.push({ ...s, todaySlots });
      }
    }
    return { active, inactive };
  }, [schedules]);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-blue-500" />
          Today's Menu Schedule
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 min-h-0">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No schedules configured</p>
        ) : (
          <div className="space-y-2">
            {active.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">
                  Currently active
                </p>
                <ul className="space-y-1">
                  {active.map(s => (
                    <li key={s.id} className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                      <span className="text-sm font-medium text-green-900">{s.name}</span>
                      <Badge className="bg-green-600 text-white text-xs">Live</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inactive.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-2">
                  Not active now
                </p>
                <ul className="space-y-1">
                  {inactive.map(s => (
                    <li key={s.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span className="text-sm text-muted-foreground">{s.name}</span>
                      {s.todaySlots.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {s.todaySlots[0].start_time} – {s.todaySlots[0].end_time}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No slot today</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-3 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1 text-xs"
          onClick={() => navigate('/menu/schedules')}
        >
          Edit schedules <ArrowRight className="h-3 w-3" />
        </Button>
      </CardFooter>
    </Card>
  );
}
