// /menu/schedules — configure dayparts (breakfast/lunch/dinner) and
// happy-hour pricing per menu item.

import { useState } from 'react';
import { Calendar, AlertCircle, Loader2 } from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/context/auth-context';
import { useSchedules } from './hooks/use-schedules';
import ScheduleList from './components/schedule-list';
import HoursGrid from './components/hours-grid';
import ItemsPicker from './components/items-picker';
import HappyHourPrices from './components/happy-hour-prices';

export default function MenuSchedules() {
  const { activeLocation } = useAuth();
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('hours');

  const {
    schedules,
    loading,
    error,
    createSchedule,
    deleteSchedule,
    fetchSlots,
    addSlot,
    deleteSlot,
    fetchItemSchedules,
    addItemSchedule,
    deleteItemSchedule,
    fetchPriceSchedules,
    upsertPriceSchedule,
    deletePriceSchedule,
    fetchItems,
  } = useSchedules(activeLocation?.id);

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mb-3 text-muted-foreground/40" />
        <p className="font-medium text-foreground">No location selected</p>
        <p className="text-sm">Please select a location to manage menu schedules.</p>
      </div>
    );
  }

  const handleSelectSchedule = (schedule) => {
    setSelected(schedule);
    setActiveTab('hours');
  };

  const handleCreate = async (form) => {
    const created = await createSchedule(form);
    // select the newly created schedule
    const newSchedule = Array.isArray(created) ? created[0] : created;
    if (newSchedule) setSelected(newSchedule);
  };

  const handleDelete = async (id) => {
    await deleteSchedule(id);
    if (selected?.id === id) setSelected(null);
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Calendar}
        title="Menu Schedules"
        description={`Configure daypart windows and happy-hour pricing for ${activeLocation.name}.`}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* body: rail + content */}
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 items-start">
        {/* left rail */}
        <aside className="rounded-2xl border border-border/60 bg-card shadow-card overflow-hidden md:sticky md:top-20">
          <ScheduleList
            schedules={schedules}
            selectedId={selected?.id}
            onSelect={handleSelectSchedule}
            onDelete={handleDelete}
            onCreate={handleCreate}
            loading={loading}
          />
        </aside>

        {/* right pane */}
        <main className="rounded-2xl border border-border/60 bg-card shadow-card p-6 min-w-0">
          {loading && !selected ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-8 w-8 mb-3 animate-spin" />
              <p className="text-sm">Loading schedules…</p>
            </div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Calendar className="h-14 w-14 mb-3 text-muted-foreground/30" />
              <p className="font-medium text-foreground">Select a schedule</p>
              <p className="text-sm">Choose a schedule from the left or create a new one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">{selected.name}</h2>
                {selected.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">{selected.description}</p>
                )}
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="hours">Hours</TabsTrigger>
                  <TabsTrigger value="items">Items</TabsTrigger>
                  <TabsTrigger value="prices">Happy-Hour Prices</TabsTrigger>
                </TabsList>

                <TabsContent value="hours" className="mt-4">
                  <HoursGrid
                    key={selected.id}
                    schedule={selected}
                    fetchSlots={fetchSlots}
                    addSlot={addSlot}
                    deleteSlot={deleteSlot}
                  />
                </TabsContent>

                <TabsContent value="items" className="mt-4">
                  <ItemsPicker
                    key={selected.id}
                    schedule={selected}
                    fetchItems={fetchItems}
                    fetchItemSchedules={fetchItemSchedules}
                    addItemSchedule={addItemSchedule}
                    deleteItemSchedule={deleteItemSchedule}
                  />
                </TabsContent>

                <TabsContent value="prices" className="mt-4">
                  <HappyHourPrices
                    key={selected.id}
                    schedule={selected}
                    fetchItems={fetchItems}
                    fetchPriceSchedules={fetchPriceSchedules}
                    upsertPriceSchedule={upsertPriceSchedule}
                    deletePriceSchedule={deletePriceSchedule}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </main>
      </div>
    </PageContainer>
  );
}
