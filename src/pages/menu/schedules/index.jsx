// /menu/schedules — configure dayparts (breakfast/lunch/dinner) and
// happy-hour pricing per menu item.

import React, { useState } from 'react';
import { Calendar, AlertCircle } from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
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
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <AlertCircle className="h-12 w-12 mb-3 text-gray-300" />
        <p className="font-medium">No location selected</p>
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
    <div className="flex flex-col h-full space-y-0">
      {/* page header */}
      <div className="px-6 py-4 border-b bg-white">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Calendar className="h-6 w-6 text-orange-500" />
          Menu Schedules
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Configure daypart windows and happy-hour pricing for {activeLocation.name}.
        </p>
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* body: rail + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* left rail */}
        <aside className="w-56 shrink-0 border-r bg-white flex flex-col min-h-0 overflow-hidden">
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
        <main className="flex-1 overflow-y-auto bg-white p-6">
          {!selected ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Calendar className="h-14 w-14 mb-3 text-gray-200" />
              <p className="font-medium text-gray-500">Select a schedule</p>
              <p className="text-sm">Choose a schedule from the left or create a new one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2>
                {selected.description && (
                  <p className="text-sm text-gray-500 mt-0.5">{selected.description}</p>
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
    </div>
  );
}
