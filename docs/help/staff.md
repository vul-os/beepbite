# Staff Management

Staff are the team members who operate the POS, manage the kitchen and handle customer-facing roles. Each staff member belongs to a location and can be assigned a role and a PIN.

---

## Adding a staff member

1. Go to **Staff → Add staff member**.
2. Enter their **name**, **role** (e.g. cashier, manager, chef), and a **4-digit PIN**.
3. Select their **location**.
4. Save. The staff member can now log in to the POS using their PIN.

## Roles and capabilities

Roles control what a staff member can do on the POS:

| Capability | Description |
|---|---|
| `can_pos` | Access the POS |
| `can_void` | Void order items |
| `can_refund` | Process refunds |
| `can_discount` | Apply discounts |
| `can_manage_cash` | Open/close cash drawer |
| `can_view_reports` | Access the reports section |

Assign capabilities when creating or editing a staff member. A **manager override** PIN can be used at the POS to temporarily grant a capability for a single action.

## PINs

- PINs are 4 digits.
- Staff log in to the POS with their PIN (or via the PIN overlay on a shared device).
- Managers have a separate **elevation token** for sensitive actions.
- PINs can be changed at any time in **Staff → [staff member] → Edit**.

## Shifts and payroll

If payroll tracking is enabled:
1. Staff clock in/out from the POS PIN screen.
2. Go to **Reports → Payroll** to view hours and calculate pay.
3. Pay rates are set per staff member under **Staff → [staff member] → Pay rate**.

## Inviting an org member

To invite someone to the organisation (with full dashboard access):
1. Go to **Settings → Team → Invite member**.
2. Enter their email and select a role.
3. They will receive an email invitation to create an account.

This is separate from staff PINs — org members access the web dashboard; staff PINs are for the POS only.
