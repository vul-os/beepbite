import React from 'react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { AlertCircle, User, TrendingUp, Shield, Calendar } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useStaffDetail } from './hooks/use-staff-detail';
import { StaffList }   from './components/staff-list';
import { ProfileTab }  from './components/profile-tab';
import { PayRatesTab } from './components/pay-rates-tab';
import { SecurityTab } from './components/security-tab';
import { ScheduleTab } from './components/schedule-tab';

export default function StaffManagePage() {
  const { activeLocation } = useAuth();

  const {
    staffList, loadingList, listError, refreshList,
    selectedStaff, selectStaff,
    rates, loadingRates, ratesError, fetchRates, createRate, patchRate,
    shifts, loadingShifts, shiftsError, fetchShifts, createShift, deleteShift,
    resetPassword, resetPin,
  } = useStaffDetail(activeLocation?.id);

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <AlertCircle className="w-12 h-12 mb-3" />
        <p className="text-base font-medium">No location selected</p>
        <p className="text-sm mt-1">Select a location to manage staff.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── left rail ── */}
      <div className="w-64 shrink-0 h-full overflow-y-auto border-r border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">Staff management</h1>
          <p className="text-xs text-gray-500">{activeLocation.name}</p>
        </div>
        <StaffList
          staffList={staffList}
          loading={loadingList}
          selectedStaff={selectedStaff}
          onSelect={selectStaff}
        />
      </div>

      {/* ── right pane ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedStaff ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <User className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">Select a staff member to view details</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {selectedStaff.first_name} {selectedStaff.last_name}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5 capitalize">{selectedStaff.role}</p>
            </div>

            <Tabs defaultValue="profile" className="w-full">
              <TabsList className="border-b border-orange-100 bg-transparent h-auto p-0 gap-0 flex">
                <TabsTrigger
                  value="profile"
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:text-orange-700 data-[state=active]:bg-orange-50 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <User className="w-3.5 h-3.5" />
                  Profile
                </TabsTrigger>
                <TabsTrigger
                  value="pay-rates"
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:text-orange-700 data-[state=active]:bg-orange-50 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  Pay rates
                </TabsTrigger>
                <TabsTrigger
                  value="security"
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:text-orange-700 data-[state=active]:bg-orange-50 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <Shield className="w-3.5 h-3.5" />
                  Security
                </TabsTrigger>
                <TabsTrigger
                  value="schedule"
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:text-orange-700 data-[state=active]:bg-orange-50 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Schedule
                </TabsTrigger>
              </TabsList>

              <div className="pt-6">
                <TabsContent value="profile">
                  <ProfileTab staff={selectedStaff} />
                </TabsContent>

                <TabsContent value="pay-rates">
                  <PayRatesTab
                    staff={selectedStaff}
                    rates={rates}
                    loading={loadingRates}
                    error={ratesError}
                    createRate={createRate}
                    patchRate={patchRate}
                  />
                </TabsContent>

                <TabsContent value="security">
                  <SecurityTab
                    staff={selectedStaff}
                    resetPassword={resetPassword}
                    resetPin={resetPin}
                  />
                </TabsContent>

                <TabsContent value="schedule">
                  <ScheduleTab
                    staff={selectedStaff}
                    locationId={activeLocation.id}
                    shifts={shifts}
                    loading={loadingShifts}
                    error={shiftsError}
                    fetchShifts={fetchShifts}
                    createShift={createShift}
                    deleteShift={deleteShift}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
