// Shared staff-role badge color mapping. Both the legacy `/staff` surface and
// the newer `/staff/manage` surface render the same 4 roles and must agree on
// their colours — this is the single source of truth for both.
export const ROLE_COLORS = {
  owner: 'bg-orange-100 text-orange-800 border-orange-200',
  admin: 'bg-purple-100 text-purple-800 border-purple-200',
  manager: 'bg-blue-100 text-blue-800 border-blue-200',
  cashier: 'bg-green-100 text-green-800 border-green-200',
  kitchen: 'bg-gray-100 text-gray-700 border-gray-200',
};

export const DEFAULT_ROLE_COLOR = 'bg-gray-50 text-gray-600 border-gray-200';

export function getRoleColor(role) {
  return ROLE_COLORS[role] ?? DEFAULT_ROLE_COLOR;
}
