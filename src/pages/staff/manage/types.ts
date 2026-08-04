// Shared types for the /staff/manage surface — mirrors backend/migrations/
// 001_baseline.sql `staff`/`staff_shifts` tables and
// backend/internal/handlers/payroll/store.go PayRate.

// Mirrors backend/migrations/001_baseline.sql `staff` table.
export interface Staff {
  id: string;
  location_id: string;
  member_id?: string | null;
  employee_id?: string | null;
  first_name: string;
  last_name: string;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  is_active: boolean;
  last_login_at?: string | null;
  failed_login_attempts?: number;
  locked_until?: string | null;
  password_hash?: string | null;
  password_set_at?: string | null;
  must_change_password?: boolean;
  pin_hash?: string | null;
  username?: string | null;
  hire_date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/internal/handlers/payroll/store.go PayRate — a
// staff_pay_rates row.
export interface PayRate {
  id: string;
  staff_id: string;
  rate_type: string;
  amount_cents: number;
  currency: string;
  commission_percentage?: number | null;
  commission_basis?: string | null;
  overtime_multiplier: number;
  overtime_threshold_hours_per_week?: number | null;
  effective_from: string; // YYYY-MM-DD
  effective_until?: string | null; // YYYY-MM-DD or null
  notes?: string | null;
  created_by?: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

// Payload shape for creating a staff_shifts row (subset of StaffShift's
// writable columns) — shared by schedule-tab.tsx (the UI that builds it) and
// use-staff-detail.ts (the hook that submits it).
export interface StaffShiftInput {
  staff_id: string;
  location_id?: string;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
  notes?: string;
  status: string;
}

// Mirrors backend/migrations/001_baseline.sql `staff_shifts` table.
export interface StaffShift {
  id: string;
  staff_id: string;
  location_id: string;
  shift_date: string; // YYYY-MM-DD
  scheduled_start: string; // HH:MM:SS
  scheduled_end: string; // HH:MM:SS
  actual_start?: string | null;
  actual_end?: string | null;
  total_hours?: number | null;
  break_duration_minutes?: number;
  status: 'scheduled' | 'completed' | 'no_show' | 'partial';
  notes?: string | null;
  created_at: string;
  updated_at: string;
}
