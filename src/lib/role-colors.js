// Shared staff-role badge color mapping. Both the legacy `/staff` surface and
// the newer `/staff/manage` surface render the same 4 roles and must agree on
// their colours — this is the single source of truth for both.
//
// These are an org-hierarchy identity tag, not a business alert, so they
// deliberately don't reach for success/warning/destructive (those are
// reserved for outcomes like paid/needs-a-look/irreversible). Instead each
// role gets a distinct but on-theme tint that still tracks light/dark mode.
export const ROLE_COLORS = {
  owner: 'bg-primary/20 text-primary border-primary/30',
  admin: 'bg-primary/10 text-primary border-primary/20',
  manager: 'bg-accent text-accent-foreground border-transparent',
  cashier: 'bg-success/10 text-success border-success/20',
  kitchen: 'bg-muted text-muted-foreground border-border',
};

export const DEFAULT_ROLE_COLOR = 'bg-muted text-muted-foreground border-border';

export function getRoleColor(role) {
  return ROLE_COLORS[role] ?? DEFAULT_ROLE_COLOR;
}
