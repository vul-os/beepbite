// workspace.jsx — dedicated POS cashier workspace (multi-ticket model).
//
// Toast/Square-style flow:
//   1. Top "tables strip" lists every table for the active location + walk-in
//      tickets the cashier has created in this session. Tap one to make it
//      active.
//   2. Tap an available table → opens a server-side `table_session` and the
//      ticket binds to it. Tap an occupied one → loads its existing orders.
//   3. Menu grid (right) adds items into the active ticket's "New" section.
//   4. "Send" fires only the new items as an additional order on this ticket;
//      they then appear in the read-only "Sent" section. Cashier can keep
//      adding rounds.
//   5. "Charge" opens a payment-method picker → cash or card modal → POST
//      /pos/orders/{id}/charge for each unpaid sent order. If the ticket is
//      table-bound, the backend closes the table_session atomically.
//
// Auth: accepts EITHER a staff PIN session (localStorage) OR a Supabase
// (owner/admin) session via useAuth(). One of them is required.

/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, ChefHat, CreditCard, Filter, Loader2, Lock, LogOut, MapPin, Plus, Receipt, RotateCcw, Scissors, Search, ShoppingBag, Unlock, User as UserIcon, UserCheck, Utensils } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { emojiFor } from '@/lib/item-emoji';

import { useAuth } from '@/context/auth-context';
import { useActor } from '@/context/actor-token-context';
import { useDateTime, useMoney } from '@/context/locale-context';
import { supabase } from '@/services/supabase-client';
import { useToast } from '@/hooks/use-toast';
import { usePinModal } from '@/hooks/use-pin-modal';
import { registerManagerOverrideHandler } from '@/lib/api-client';
import {
  clearStoredRegister,
  getOpenSession,
  getStaff,
  getStaffDisplayName,
  persistRegister,
  readStoredRegister,
  submitPosOrder,
} from '@/services/pos';
import {
  listOpenSessions,
  listTables,
  listSections,
  openTableSession,
  transferSession,
  getSessionDetail,
} from '@/services/tables';
import { chargeOrdersWithLegs } from '@/services/payment';

import OpenRegisterModal from '@/pages/home/components/open-register-modal';
import ReturnModal from '@/pages/home/components/return-modal';
import { TablesStrip } from './components/tables-strip';
import ActiveTicketPanel from './components/active-ticket-panel';
import CashTenderModal from './components/cash-tender-modal';
import { CardTenderModal } from './components/card-tender-modal';
import { TablePickerDialog } from './components/table-picker-dialog';
import AdjustmentModal from '@/components/order-adjustments/adjustment-modal';
import TenderModal from './components/tender-modal';
import SplitBySeat from './components/split-by-seat';
import ModifierPicker, { useItemHasModifiers } from './components/modifier-picker';
import ReceiptModal from './components/receipt-modal';

// ---------------------------------------------------------------------------
// Service-style helpers
// ---------------------------------------------------------------------------

/**
 * Per-location service style stored in localStorage.
 * 'dine_in'  — the business has tables and uses the floor plan.
 * 'takeaway' — counter / market stall / delivery-only; no tables needed.
 *
 * Key: bb_service_style_<locationId>
 * Default: 'dine_in' (preserve existing behaviour for locations that have
 * already set up a floor plan; takeaway-only users switch explicitly).
 */
function getServiceStyle(locationId) {
  if (!locationId) return 'dine_in';
  try {
    const v = localStorage.getItem(`bb_service_style_${locationId}`);
    return v === 'takeaway' ? 'takeaway' : 'dine_in';
  } catch {
    return 'dine_in';
  }
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const uuid = () =>
  (crypto?.randomUUID?.() ||
    `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

/**
 * Compute remaining_today from the raw daily countdown columns.
 * Returns null when daily_quantity is null/undefined (unlimited).
 * Returns GREATEST(daily_quantity - today's sold count, 0) otherwise.
 *
 * `todayStr` is the store's LOCAL trading date and must be passed in. Deriving
 * it here from toISOString() would give the UTC date, so a Los Angeles till
 * would roll over to tomorrow's counters at 16:00 and show today's sold-out
 * items as available again.
 */
function computeRemainingToday(item, todayStr) {
  if (item.daily_quantity == null) return null;
  const soldToday =
    item.daily_counter_date === todayStr
      ? (item.daily_sold_count ?? 0)
      : 0;
  return Math.max(item.daily_quantity - soldToday, 0);
}

/**
 * Small inline pill showing the daily countdown for an item tile.
 * Defensive: renders nothing when remaining is null/undefined.
 */
function ItemCountdownPill({ remaining }) {
  if (remaining === null || remaining === undefined) return null;
  if (remaining === 0) {
    return (
      <span className="absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-destructive text-destructive-foreground leading-none">
        Sold out
      </span>
    );
  }
  return (
    <span className="absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500 text-white leading-none">
      {remaining} left
    </span>
  );
}

// Build a fresh client-side ticket for a walk-in / takeaway.
function makeWalkInTicket(n) {
  return {
    id: `walkin-${uuid()}`,
    kind: 'walkin',
    label: `Walk-in #${n}`,
    newItems: [],
    sentOrders: [],
  };
}

// Build a ticket from a server-side table_session row + a table row.
function ticketFromSession({ session, table, section, orders = [] }) {
  return {
    id: session.id,                 // ticket id == session id
    kind: 'table',
    sessionId: session.id,
    tableId: session.table_id || table?.id,
    table_number: table?.label,
    section_name: section?.name,
    party_size: session.party_size || 1,
    newItems: [],
    sentOrders: orders,
  };
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PosWorkspacePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeLocation, user, userProfile, signOut } = useAuth();
  const { format, scale } = useMoney();
  const { today } = useDateTime();
  // The store's local trading date, not the browser's UTC one.
  const todayStr = today();

  // ----- PIN re-auth (actor expiry) -------------------------------------
  // usePinModal auto-triggers the PIN modal when the actor expires while on
  // /pos/workspace, preserving all in-progress cart/ticket state.
  // requestPin is also exported so child actions (e.g. void) can trigger
  // manager-override flows directly.
  const { requestPin } = usePinModal();
  // Make requestPin accessible to sub-handlers via ref so closures stay stable.
  const requestPinRef = useRef(requestPin);
  requestPinRef.current = requestPin;

  // Register the manager-override handler with the api-client for the lifetime
  // of this workspace page. On 403 missing_capability, the client will call
  // this to open the PIN modal and obtain a one-shot manager token, then replay
  // the original request automatically.
  useEffect(() => {
    const unregister = registerManagerOverrideHandler(async ({ capability, reason }) => {
      const token = await requestPinRef.current({
        reason: reason || capability,
        isManagerOverride: true,
      });
      return token;
    });
    return unregister;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- actor overlay (T9.5) --------------------------------------------
  const { actor, clearActor } = useActor();
  // Display name comes from:
  //  1. The actor overlay (staff.display_name from /pos/pin-verify)
  //  2. Legacy staff localStorage session
  //  3. Member profile / OAuth name
  const actorDisplayName = actor?.display_name || null;

  // ----- auth gate -------------------------------------------------------
  const staff = useMemo(() => getStaff(), []);
  const staffName = useMemo(() => getStaffDisplayName(), []);
  const displayName = actorDisplayName || staffName || userProfile?.first_name
    || user?.user_metadata?.name || user?.email || 'User';
  // The device is authed if: (a) actor overlay set, (b) legacy staff session, or (c) member JWT.
  const isAuthed = Boolean(actor || staff || user);
  useEffect(() => { if (!isAuthed) navigate('/pos/login', { replace: true }); }, [isAuthed, navigate]);

  // Owner/manager detection — used to gate the "Design floor plan" CTA.
  // Signals, in priority order:
  //   1. Actor PIN overlay → its role string (owner/manager/admin).
  //   2. Legacy staff PIN session → its role string.
  //   3. No staff/actor at all → an owner/admin Supabase email login (full access).
  const isOwnerManager = useMemo(() => {
    const elevated = (r) => ['owner', 'manager', 'admin'].includes(String(r || '').toLowerCase());
    if (actor) return elevated(actor.role);
    if (staff) return elevated(staff.role);
    // Supabase email session with no staff overlay == owner/admin.
    return Boolean(user);
  }, [actor, staff, user]);

  // ----- register session ------------------------------------------------
  // Mirrors home/index.jsx: only staff PIN sessions need an open cash drawer.
  // Owners/admins (Supabase email login) can place orders without one — they
  // typically don't have a physical till in front of them anyway.
  const isStaffSession = Boolean(staff);
  const stored = useMemo(() => readStoredRegister(), []);
  const [registerSession, setRegisterSession] = useState(null);
  const [registerLoading, setRegisterLoading] = useState(isStaffSession);
  const [isOpenRegisterOpen, setIsOpenRegisterOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  // Effective gate used everywhere downstream — `true` when the cashier may
  // place orders. Owners always pass; staff need an open register.
  const canTakeOrders = !isStaffSession || Boolean(registerSession);

  // ----- courses (Wave 11 — T11.2/T11.3) -----------------------------------
  // Loaded once per location; passed down to ticket lines for course assignment.
  const [courses, setCourses] = useState([]);
  useEffect(() => {
    if (!activeLocation?.id) { setCourses([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('courses')
          .select('id, name, sort_order, fire_on_previous_course_bumped')
          .eq('location_id', activeLocation.id)
          .eq('is_active', true)
          .order('sort_order', { ascending: true });
        if (!cancelled) setCourses(data || []);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [activeLocation?.id]);

  // ----- menu state ------------------------------------------------------
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');

  // ----- tables / sessions ----------------------------------------------
  const [tables, setTables] = useState([]);
  const [sections, setSections] = useState([]);
  const [tablesLoading, setTablesLoading] = useState(true);

  // Map<ticketId, Ticket> — both table-bound and walk-in tickets.
  // Using an object (plain map) for predictable React equality.
  const [tickets, setTickets] = useState({});
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [walkInCounter, setWalkInCounter] = useState(1);
  const [openingTable, setOpeningTable] = useState(false);

  // A floor plan exists once the location has at least one table row. Until
  // then, dine-in cannot proceed (there is nothing to seat a guest at).
  const hasFloorPlan = tables.length > 0;

  // Service style: 'dine_in' or 'takeaway'. Loaded from localStorage and
  // refreshed whenever the active location changes. Takeaway-only locations
  // never show the Eat-in button or the NoFloorPlanCard nag.
  const [serviceStyle, setServiceStyle] = useState(() =>
    getServiceStyle(activeLocation?.id)
  );
  useEffect(() => {
    setServiceStyle(getServiceStyle(activeLocation?.id));
  }, [activeLocation?.id]);
  const isDineInMode = serviceStyle === 'dine_in';

  const handleDesignFloor = useCallback(() => {
    navigate('/floor/edit');
  }, [navigate]);

  // Assign a course to a new (unsent) item on the active ticket.
  // Defined here (after tickets/activeTicketId state) to avoid a temporal
  // dead-zone error from the parallel Wave 11 edits.
  const handleSetCourse = useCallback((clientId, courseId) => {
    if (!activeTicketId) return;
    setTickets((prev) => {
      const t = prev[activeTicketId];
      if (!t) return prev;
      return {
        ...prev,
        [activeTicketId]: {
          ...t,
          newItems: t.newItems.map((ni) =>
            ni.id === clientId ? { ...ni, course_id: courseId || null } : ni,
          ),
        },
      };
    });
  }, [activeTicketId]);

  // ----- send/charge state ----------------------------------------------
  const [sending, setSending] = useState(false);
  const [chargeMethod, setChargeMethod] = useState(null); // 'cash' | 'card' | null
  const [chargeError, setChargeError] = useState('');
  const [chargeBusy, setChargeBusy] = useState(false);
  const [showMethodPicker, setShowMethodPicker] = useState(false);

  // ----- assign-table flow -----------------------------------------------
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [assigningTable, setAssigningTable] = useState(false);

  // ----- modifier picker state --------------------------------------------
  const [modifierPickerItem, setModifierPickerItem] = useState(null); // item being customised
  const { check: checkHasModifiers } = useItemHasModifiers();

  // ----- adjustment modal state -------------------------------------------
  const [adjustmentModal, setAdjustmentModal] = useState(null); // { orderId, type } | null

  const handleOpenAdjustment = useCallback(({ orderId, type }) => {
    setAdjustmentModal({ orderId, type });
  }, []);

  // Eat-in entry point. A dine-in order needs a table; if no floor plan has
  // been designed (zero tables for this location) there is nothing to pick, so
  // we surface friendly guidance instead of a destructive toast. In
  // takeaway-only mode this handler is never called from the main flow —
  // it's still reachable from the "Assign Table" header button for walk-ins.
  const handleStartEatIn = useCallback(() => {
    if (!hasFloorPlan) {
      toast({
        title: 'No tables set up yet',
        description: isOwnerManager
          ? 'Set up a floor plan to start seating dine-in guests. Takeaway always works without one.'
          : 'Ask your manager to set up the floor plan when you need dine-in seating. You can still take takeaway orders.',
      });
      return;
    }
    setShowTablePicker(true);
  }, [hasFloorPlan, isOwnerManager, toast]);

  // ----- split tender (TenderModal) state ---------------------------------
  const [showTenderModal, setShowTenderModal] = useState(false);
  const [tenderError, setTenderError] = useState('');

  // ----- receipt modal state ----------------------------------------------
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState(null);

  // ----- split-by-seat state ----------------------------------------------
  const [showSplitBySeat, setShowSplitBySeat] = useState(false);

  // ===== effects =========================================================

  // Register check — only for staff PIN sessions.
  useEffect(() => {
    if (!isStaffSession) { setRegisterLoading(false); return; }
    if (!activeLocation?.id) { setRegisterLoading(false); return; }
    let cancelled = false;
    setRegisterLoading(true);
    (async () => {
      try {
        let drawerId = stored?.drawerId || '';
        if (!drawerId) {
          const { data } = await supabase
            .from('cash_drawers').select('id')
            .eq('location_id', activeLocation.id).eq('is_active', true).limit(1);
          drawerId = data?.[0]?.id || '';
        }
        if (!drawerId) {
          // No drawer configured for this location — staff can't take cash
          // orders until one is created in settings. Show a non-blocking toast
          // rather than auto-popping a modal the cashier can't act on.
          if (!cancelled) {
            setRegisterSession(null);
            toast({
              variant: 'destructive',
              title: 'No cash drawer configured',
              description: 'Ask an admin to add one in Settings → Location.',
            });
          }
          return;
        }
        const session = await getOpenSession(drawerId);
        if (cancelled) return;
        if (session?.id) {
          setRegisterSession(session);
          persistRegister({ sessionId: session.id, drawerId, openedAt: session.opened_at });
        } else {
          clearStoredRegister();
          setRegisterSession(null);
          setIsOpenRegisterOpen(true);
        }
      } catch (err) {
        if (!cancelled) console.error('Register check failed:', err);
      } finally {
        if (!cancelled) setRegisterLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation?.id, isStaffSession]);

  // Menu load
  useEffect(() => {
    if (!activeLocation?.id) {
      setItems([]); setCategories([]); setLoadingMenu(false);
      return;
    }
    let cancelled = false;
    setLoadingMenu(true);
    (async () => {
      try {
        const [{ data: cats }, { data: rows }] = await Promise.all([
          supabase.from('categories').select('id, name')
            .eq('location_id', activeLocation.id).eq('is_active', true)
            .order('sort_order', { ascending: true }).order('name', { ascending: true }),
          supabase.from('items').select(`
            id, name, description, price, category_id, is_86ed,
            daily_quantity, daily_sold_count, daily_counter_date,
            categories ( id, name )
          `).eq('location_id', activeLocation.id).eq('is_active', true)
            .order('sort_order', { ascending: true }).order('name', { ascending: true }),
        ]);
        if (cancelled) return;
        setCategories(cats || []);
        setItems(rows || []);
      } catch (err) {
        console.error('Menu load failed:', err);
        if (!cancelled) toast({ variant: 'destructive', title: 'Menu failed to load', description: err.message });
      } finally {
        if (!cancelled) setLoadingMenu(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeLocation?.id, toast]);

  // Tables + open sessions
  const refreshTables = useCallback(async () => {
    if (!activeLocation?.id) return;
    setTablesLoading(true);
    try {
      const [tbls, secs] = await Promise.all([
        listTables(activeLocation.id),
        listSections(activeLocation.id),
      ]);
      setTables(tbls);
      setSections(secs);
    } catch (err) {
      console.error('Tables load failed:', err);
    } finally {
      setTablesLoading(false);
    }
  }, [activeLocation?.id]);

  // Initial load: tables + open sessions → build tickets
  useEffect(() => {
    if (!activeLocation?.id) return;
    let cancelled = false;
    (async () => {
      await refreshTables();
      try {
        const openSessions = await listOpenSessions(activeLocation.id);
        if (cancelled) return;
        // For each open session, hydrate orders via SessionDetail.
        const detailFetches = await Promise.all(
          openSessions.map((s) => getSessionDetail(s.id).catch(() => null)),
        );
        if (cancelled) return;
        const tbls = await listTables(activeLocation.id);
        const secs = await listSections(activeLocation.id);
        if (cancelled) return;
        const next = {};
        detailFetches.forEach((detail) => {
          if (!detail) return;
          const session = detail.session || detail;
          const table = tbls.find((t) => t.id === session.table_id);
          const section = secs.find((s) => s.id === table?.section_id);
          // Hydrate orders attached to this session into "sent" form.
          const sentOrders = (detail.orders || []).map((o) => ({
            id: o.id,
            order_number: o.order_number,
            created_at: o.created_at,
            payment_status: o.payment_status || 'pending',
            total_cents: typeof o.total_amount_cents === 'number'
              ? o.total_amount_cents
              : (typeof o.total === 'number' ? Math.round(o.total * scale) : 0),
            items: (o.items || []).map((it) => ({
              order_item_id: it.id,
              item_name: it.item_name || it.name,
              quantity: it.quantity,
              unit_price: it.unit_price,
              total_cents: typeof it.total_cents === 'number'
                ? it.total_cents
                : Math.round((parseFloat(it.unit_price || 0) * (it.quantity || 0)) * scale),
              item_status: it.item_status || 'fired',
              notes: it.notes,
            })),
          }));
          next[session.id] = ticketFromSession({ session, table, section, orders: sentOrders });
        });
        setTickets(next);
      } catch (err) {
        console.error('Open sessions load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeLocation?.id, refreshTables, scale]);

  // ===== derived =========================================================

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (categoryId !== 'all' && it.category_id !== categoryId) return false;
      if (!q) return true;
      return it.name?.toLowerCase().includes(q)
        || it.description?.toLowerCase().includes(q)
        || it.categories?.name?.toLowerCase().includes(q);
    });
  }, [items, categoryId, search]);

  const activeTicket = activeTicketId ? tickets[activeTicketId] : null;

  // Decorate table tiles with the active ticket subtotal
  const tableTiles = useMemo(() => {
    return tables.map((t) => {
      const ticket = Object.values(tickets).find((x) => x.kind === 'table' && x.tableId === t.id);
      const subtotal = ticket
        ? subtotalCentsOfTicket(ticket, scale)
        : 0;
      return {
        ...t,
        section_name: sections.find((s) => s.id === t.section_id)?.name,
        subtotal_cents: subtotal,
        // mark as occupied if we have an open ticket for it (covers fresh-opens
        // before refreshTables() has caught up)
        status: ticket ? 'occupied' : t.status,
      };
    });
  }, [tables, sections, tickets, scale]);

  const walkInTiles = useMemo(() => {
    return Object.values(tickets)
      .filter((t) => t.kind === 'walkin')
      .map((t) => ({
        id: t.id,
        label: t.label,
        subtotal_cents: subtotalCentsOfTicket(t, scale),
        item_count: t.newItems.reduce((s, it) => s + it.qty, 0)
                  + t.sentOrders.reduce((s, o) => s + (o.items?.length || 0), 0),
      }));
  }, [tickets, scale]);

  // ===== handlers ========================================================

  const updateTicket = (ticketId, patch) => {
    setTickets((prev) => {
      const t = prev[ticketId];
      if (!t) return prev;
      return { ...prev, [ticketId]: typeof patch === 'function' ? patch(t) : { ...t, ...patch } };
    });
  };

  const handleSelectTile = useCallback(async (ticketId, kind) => {
    if (kind === 'walkin') {
      setActiveTicketId(ticketId);
      return;
    }
    // table tile — find existing ticket bound to this table OR open a session
    const existing = Object.values(tickets).find(
      (t) => t.kind === 'table' && t.tableId === ticketId,
    );
    if (existing) {
      setActiveTicketId(existing.id);
      return;
    }
    if (openingTable) return;
    setOpeningTable(true);
    try {
      const session = await openTableSession({
        tableId: ticketId,
        locationId: activeLocation.id,
        partySize: 1,
        openedBy: staff?.id || undefined,
      });
      const table = tables.find((t) => t.id === ticketId);
      const section = sections.find((s) => s.id === table?.section_id);
      const newTicket = ticketFromSession({ session, table, section, orders: [] });
      setTickets((prev) => ({ ...prev, [newTicket.id]: newTicket }));
      setActiveTicketId(newTicket.id);
      // mark the table as occupied locally
      setTables((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: 'occupied' } : t));
      toast({ title: `Opened ${table?.label ? `Table ${table.label}` : 'table'}` });
    } catch (err) {
      console.error('Open session failed:', err);
      toast({
        variant: 'destructive',
        title: 'Could not open this table',
        description: err.message || 'Try again.',
      });
    } finally {
      setOpeningTable(false);
    }
  }, [tickets, openingTable, activeLocation?.id, staff?.id, user?.id, tables, sections, toast]);

  const handleAddWalkIn = useCallback(() => {
    const t = makeWalkInTicket(walkInCounter);
    setWalkInCounter((n) => n + 1);
    setTickets((prev) => ({ ...prev, [t.id]: t }));
    setActiveTicketId(t.id);
  }, [walkInCounter]);

  // commitAddItem — called directly (no modifiers) or after modifier picker confirms.
  const commitAddItem = useCallback((item, { extraCents = 0, selectedModifiers = [], linePriceCents = null } = {}) => {
    const basePrice = parseFloat(item.price || 0);
    // Cart lines carry a major-unit price, so minor units are divided back by
    // the currency's scale — 100 would turn a ¥120 modifier into ¥1.20.
    const linePrice = linePriceCents != null ? linePriceCents / scale : basePrice + (extraCents / scale);
    updateTicket(activeTicket.id, (t) => {
      // Only stack quantity when there are no per-line modifier overrides.
      const canStack = selectedModifiers.length === 0;
      if (canStack) {
        const idx = t.newItems.findIndex((ni) => ni.item_id === item.id && !ni.modifier_ids?.length);
        if (idx >= 0) {
          const next = t.newItems.slice();
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
          return { ...t, newItems: next };
        }
      }
      return {
        ...t,
        newItems: [
          ...t.newItems,
          {
            id: uuid(),
            item_id: item.id,
            name: item.name,
            price: linePrice,
            qty: 1,
            variation_option_ids: [],
            modifier_ids: selectedModifiers.map((m) => m.id),
            modifier_names: selectedModifiers.map((m) => m.name),
          },
        ],
      };
    });
  }, [activeTicket, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddItem = useCallback(async (item) => {
    if (!activeTicket) {
      toast({ title: 'Pick a table or start a walk-in first' });
      return;
    }
    if (isStaffSession && !registerSession) {
      setIsOpenRegisterOpen(true);
      return;
    }
    // Check if this item has modifier groups — if so, open the picker.
    const has = await checkHasModifiers(item.id);
    if (has) {
      setModifierPickerItem(item);
      return;
    }
    commitAddItem(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicket, registerSession, toast, commitAddItem, checkHasModifiers]);

  // One-tap 86: mark an item sold out (or restore it) straight from the tile —
  // no trip to the back office. Optimistic; reverts on failure.
  const [toggling86, setToggling86] = useState(null); // item id mid-flight
  const handleToggle86 = useCallback(async (item) => {
    const next = !item.is_86ed;
    setToggling86(item.id);
    setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, is_86ed: next } : it));
    const { error } = await supabase.from('items').update({ is_86ed: next }).eq('id', item.id);
    setToggling86(null);
    if (error) {
      // revert
      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, is_86ed: !next } : it));
      toast({ variant: 'destructive', title: '86 failed', description: error.message });
      return;
    }
    toast({
      title: next ? `86'd ${item.name}` : `${item.name} is back on`,
      description: next ? 'Removed from ordering until you restore it.' : 'Available to order again.',
    });
  }, [toast]);

  const handleBumpQty = (clientId, delta) => {
    if (!activeTicket) return;
    updateTicket(activeTicket.id, (t) => ({
      ...t,
      newItems: t.newItems
        .map((ni) => ni.id === clientId ? { ...ni, qty: Math.max(0, ni.qty + delta) } : ni)
        .filter((ni) => ni.qty > 0),
    }));
  };

  const handleRemoveItem = (clientId) => {
    if (!activeTicket) return;
    updateTicket(activeTicket.id, (t) => ({
      ...t,
      newItems: t.newItems.filter((ni) => ni.id !== clientId),
    }));
  };

  const handleSend = useCallback(async () => {
    if (!activeTicket || activeTicket.newItems.length === 0) return;
    if (isStaffSession && !registerSession) { setIsOpenRegisterOpen(true); return; }
    setSending(true);
    try {
      const result = await submitPosOrder({
        locationId: activeLocation.id,
        orderType: activeTicket.kind === 'table' ? 'dine_in' : 'takeaway',
        tableNumber: activeTicket.kind === 'table' ? String(activeTicket.table_number || activeTicket.label || '') : undefined,
        registerSessionId: registerSession?.id,
        items: activeTicket.newItems.map((ni) => {
          const lineItem = {
            item_id: ni.item_id,
            quantity: ni.qty,
            notes: ni.notes || undefined,
          };
          if (ni.course_id) lineItem.course_id = ni.course_id;
          if (ni.modifier_ids && ni.modifier_ids.length > 0) {
            lineItem.modifiers = ni.modifier_ids.map((id) => ({ modifier_id: id }));
          }
          return lineItem;
        }),
      });
      // Build a "sent order" record from the cart we just sent.
      const sentItems = activeTicket.newItems.map((ni) => ({
        order_item_id: `cli-${ni.id}`,
        item_name: ni.name,
        quantity: ni.qty,
        unit_price: ni.price,
        total_cents: Math.round(ni.price * ni.qty * scale),
        item_status: 'fired',
      }));
      const sentOrder = {
        id: result.order_id,
        order_number: result.order_number,
        created_at: new Date().toISOString(),
        payment_status: 'pending',
        total_cents: typeof result.total === 'number'
          ? Math.round(result.total * scale)
          : sentItems.reduce((s, it) => s + it.total_cents, 0),
        items: sentItems,
      };
      updateTicket(activeTicket.id, (t) => ({
        ...t,
        newItems: [],
        sentOrders: [...t.sentOrders, sentOrder],
      }));
      toast({
        title: `Order #${sentOrder.order_number} sent to kitchen ✓`,
        description: `${sentItems.length} item${sentItems.length === 1 ? '' : 's'} fired`,
      });
    } catch (err) {
      console.error('Send failed:', err);
      toast({ variant: 'destructive', title: 'Send failed', description: err.message });
    } finally {
      setSending(false);
    }
  }, [activeTicket, registerSession, activeLocation?.id, toast, scale]);

  const handleOpenCharge = () => {
    if (!activeTicket || activeTicket.sentOrders.length === 0) return;
    setTenderError('');
    setShowTenderModal(true);
  };

  const handlePickMethod = (code) => {
    setShowMethodPicker(false);
    setChargeMethod(code);
  };

  // Run charge for ALL unpaid orders using split-tender legs from TenderModal.
  const runCharge = async (legs) => {
    if (!activeTicket) return;
    setChargeBusy(true);
    setTenderError('');
    try {
      const unpaid = activeTicket.sentOrders.filter((o) => o.payment_status !== 'paid');
      // Capture the first order id now, before state is cleared, so we can
      // pass it to the receipt modal after the tender modal closes.
      const firstOrderId = unpaid[0]?.id || activeTicket.sentOrders[0]?.id || null;
      const results = await chargeOrdersWithLegs({
        orders: unpaid,
        legs,
        processedByStaffId: staff?.id || undefined,
      });
      // Mark all as paid locally
      updateTicket(activeTicket.id, (t) => ({
        ...t,
        sentOrders: t.sentOrders.map((o) => ({ ...o, payment_status: 'paid' })),
      }));
      const sessionClosed = results.some((r) => r.session_closed);
      toast({
        title: 'Payment received ✓',
        description: sessionClosed ? 'Table closed.' : 'Order marked paid.',
      });
      // Close tender modal first, then open receipt after a brief delay so the
      // two dialogs don't stack on top of each other.
      setShowTenderModal(false);
      if (firstOrderId) {
        setTimeout(() => {
          setReceiptOrderId(firstOrderId);
          setReceiptOpen(true);
        }, 150);
      }
      // If table-bound ticket and session closed, drop the ticket and refresh tables.
      if (sessionClosed && activeTicket.kind === 'table') {
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];
          return next;
        });
        setActiveTicketId(null);
        refreshTables();
      } else if (activeTicket.kind === 'walkin') {
        // walk-in is done — drop it
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];
          return next;
        });
        setActiveTicketId(null);
      }
      setChargeMethod(null);
    } catch (err) {
      console.error('Charge failed:', err);
      setTenderError(err.message || 'Charge failed');
    } finally {
      setChargeBusy(false);
    }
  };

  // Charge a single seat split: find the orders that contain its items and
  // record payment legs for that split's amount.
  const handleChargeSplit = useCallback(async (_splitId, legs) => {
    if (!activeTicket) return;
    // For a seat split we charge the full-ticket orders proportionally —
    // the split just determines the tender amount already baked into legs.
    const unpaid = activeTicket.sentOrders.filter((o) => o.payment_status !== 'paid');
    await chargeOrdersWithLegs({
      orders: unpaid,
      legs,
      processedByStaffId: staff?.id || undefined,
    });
  }, [activeTicket, staff?.id]);

  // ----- assign / change table for the active ticket ---------------------
  // Walk-in → table: open a new table_session, move items into a new ticket
  // keyed by session id, drop the old walk-in ticket.
  // Table → table: call transferSession() which moves party + linked orders
  // server-side; rebuild the ticket under the new session id.
  const handleAssignTable = useCallback(async (table) => {
    if (!activeTicket || !table || assigningTable) return;
    setAssigningTable(true);
    try {
      if (activeTicket.kind === 'walkin') {
        const session = await openTableSession({
          tableId: table.id,
          locationId: activeLocation.id,
          partySize: 1,
          openedBy: staff?.id || undefined,
        });
        const section = sections.find((s) => s.id === table.section_id);
        const newTicket = ticketFromSession({
          session,
          table,
          section,
          orders: activeTicket.sentOrders, // preserve any already-sent rounds (rare for walk-ins, but safe)
        });
        newTicket.newItems = activeTicket.newItems; // carry over unsent items
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];          // drop the walk-in record
          next[newTicket.id] = newTicket;
          return next;
        });
        setActiveTicketId(newTicket.id);
        setTables((prev) => prev.map((t) => t.id === table.id ? { ...t, status: 'occupied' } : t));
        toast({ title: `Assigned to Table ${table.label}` });
      } else if (activeTicket.kind === 'table') {
        if (table.id === activeTicket.tableId) {
          toast({ title: 'Already on this table' });
          return;
        }
        const newSession = await transferSession(activeTicket.sessionId, {
          toTableId: table.id,
          openedBy: staff?.id || undefined,
          partySize: activeTicket.party_size,
        });
        const section = sections.find((s) => s.id === table.section_id);
        const newTicket = ticketFromSession({
          session: newSession,
          table,
          section,
          orders: activeTicket.sentOrders,
        });
        newTicket.newItems = activeTicket.newItems;
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];
          next[newTicket.id] = newTicket;
          return next;
        });
        setActiveTicketId(newTicket.id);
        // refresh tables: old one frees up, new one occupies
        refreshTables();
        toast({ title: `Moved to Table ${table.label}` });
      }
      setShowTablePicker(false);
    } catch (err) {
      console.error('Assign table failed:', err);
      toast({
        variant: 'destructive',
        title: 'Could not assign table',
        description: err.message || 'Try again.',
      });
    } finally {
      setAssigningTable(false);
    }
  }, [activeTicket, assigningTable, activeLocation?.id, sections, staff?.id, user?.id, refreshTables, toast]);

  // ----- end shift (actor overlay) ----------------------------------------
  // Used by the "End shift / Switch user" button in the header.
  const handleEndShift = () => {
    clearStoredRegister();
    clearActor();
    // Navigate back to the slug-scoped PIN page that started this session.
    const slug = actor?.slug;
    if (slug) {
      navigate(`/s/${slug}`, { replace: true });
    } else {
      navigate('/pos/login', { replace: true });
    }
  };

  // ----- sign out --------------------------------------------------------
  const handleSignOut = async () => {
    clearStoredRegister();
    if (actor) {
      // Actor overlay session — clear actor and go back to PIN screen.
      handleEndShift();
      return;
    }
    if (staff) {
      localStorage.removeItem('bb.auth');
      navigate('/pos/login', { replace: true });
    } else {
      try { await signOut(); } catch (e) { console.error(e); }
      navigate('/signin', { replace: true });
    }
  };

  // ===== render ==========================================================

  if (!isAuthed) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  const activeTicketTotalCents = activeTicket ? subtotalCentsOfTicket(activeTicket, scale) : 0;
  const activeUnpaidCents = activeTicket
    ? activeTicket.sentOrders
        .filter((o) => o.payment_status !== 'paid')
        .reduce((s, o) => s + (o.total_cents || 0), 0)
    : 0;

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 to-orange-50/40 dark:from-gray-950 dark:to-gray-900 overflow-hidden">
      {/* ============================== TOP BAR ============================== */}
      <header className="bg-card border-b border-orange-200 dark:border-orange-900/50 shadow-sm shrink-0">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-md">
              <Receipt className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-sm font-bold text-gray-900 dark:text-white truncate">POS Workspace</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                <UserIcon className="w-3 h-3" />
                {displayName}
                {/* Actor overlay chip — shown when staff logged in via /s/:slug PIN */}
                {actor && (
                  <span className="ml-0.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-semibold uppercase tracking-wide">
                    <UserCheck className="w-2.5 h-2.5" />
                    {actor.role || 'Staff'}
                  </span>
                )}
                {!actor && !staff && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[9px] font-semibold uppercase tracking-wide">
                    Owner
                  </span>
                )}
                {activeLocation?.name && (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="truncate">{activeLocation.name}</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Register pill — only relevant for staff PIN sessions. */}
          {isStaffSession && (
            <div className="hidden sm:flex items-center gap-2">
              {registerLoading ? (
                <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking register…
                </span>
              ) : registerSession ? (
                <button type="button" onClick={() => setIsOpenRegisterOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-950/70 text-xs font-semibold transition">
                  <Unlock className="w-3 h-3" /> Register Open
                </button>
              ) : (
                <button type="button" onClick={() => setIsOpenRegisterOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 text-xs font-semibold transition animate-pulse">
                  <Lock className="w-3 h-3" /> Open Register
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {activeTicket && isDineInMode && (
              <Button size="sm" variant="outline" onClick={handleStartEatIn}
                aria-label={activeTicket.kind === 'walkin' ? 'Assign this ticket to a table' : 'Move to a different table'}
                className="border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 h-9 focus-visible:ring-2 focus-visible:ring-orange-400">
                <MapPin className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                <span className="hidden md:inline">
                  {activeTicket.kind === 'walkin' ? 'Assign Table' : 'Move Table'}
                </span>
              </Button>
            )}
            {activeTicket?.kind === 'table' && activeTicket?.sentOrders?.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowSplitBySeat(true)}
                aria-label="Split check by seat"
                className="border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 h-9 focus-visible:ring-2 focus-visible:ring-orange-400">
                <Scissors className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                <span className="hidden md:inline">Split</span>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setIsReturnOpen(true)} disabled={isStaffSession && !registerSession}
              aria-label="Process a return"
              className="border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 h-9 focus-visible:ring-2 focus-visible:ring-orange-400">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              <span className="hidden md:inline">Return</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/kds/expo')}
              aria-label="Open Kitchen Display System"
              className="border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 h-9 focus-visible:ring-2 focus-visible:ring-orange-400">
              <ChefHat className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              <span className="hidden md:inline">Kitchen</span>
            </Button>
            {/* End shift / Switch user — shown when an actor overlay is active. */}
            {actor && (
              <Button size="sm" variant="outline" onClick={handleEndShift}
                aria-label="End shift and return to PIN screen"
                className="border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 h-9 focus-visible:ring-2 focus-visible:ring-emerald-400">
                <UserCheck className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                <span className="hidden md:inline">End shift</span>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={handleSignOut}
              aria-label="Sign out"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white h-9 focus-visible:ring-2 focus-visible:ring-gray-400">
              <LogOut className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              <span className="hidden md:inline">Sign Out</span>
            </Button>
          </div>
        </div>

        {/* Tables strip */}
        <div className="px-3 py-2 border-t border-orange-100 dark:border-orange-900/40 bg-orange-50/30 dark:bg-orange-950/20">
          <TablesStrip
            tables={tableTiles}
            walkIns={walkInTiles}
            activeTicketId={activeTicket?.kind === 'table' ? activeTicket.tableId : activeTicketId}
            onSelect={handleSelectTile}
            onAddWalkIn={handleAddWalkIn}
            loading={tablesLoading}
            canDesignFloor={isOwnerManager}
            onDesignFloor={handleDesignFloor}
            isDineInMode={isDineInMode}
          />
        </div>
      </header>

      {/* ============================== MAIN ============================== */}
      <main className="flex-1 flex overflow-hidden">
        {/* Menu */}
        <section className="flex-1 flex flex-col min-w-0 bg-card">
          <div className="px-4 py-3 border-b border-orange-100 dark:border-orange-900/40">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <Input
                placeholder="Search menu…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search menu items"
                className="pl-10 h-11 border-orange-200 focus:border-orange-400 focus-visible:ring-1 focus-visible:ring-orange-400 rounded-xl text-sm"
              />
            </div>
          </div>

          {/* Category filter — horizontally scrollable pill row */}
          <div
            role="group"
            aria-label="Filter by category"
            className="px-3 py-2 border-b border-orange-100 dark:border-orange-900/40 overflow-x-auto scrollbar-none"
            style={{ scrollbarWidth: 'none' }}
          >
            <div className="flex gap-1.5 min-w-max">
              <button
                type="button"
                onClick={() => setCategoryId('all')}
                aria-pressed={categoryId === 'all'}
                className={cn(
                  'inline-flex items-center gap-1 h-9 rounded-full px-3.5 text-xs font-semibold whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                  categoryId === 'all'
                    ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                    : 'border-orange-200 dark:border-orange-800 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:border-orange-300 dark:hover:border-orange-700',
                )}
              >
                <Filter className="w-3 h-3" /> All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={categoryId === c.id}
                  className={cn(
                    'h-9 rounded-full px-3.5 text-xs font-semibold whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
                    categoryId === c.id
                      ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                      : 'border-orange-200 dark:border-orange-800 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:border-orange-300 dark:hover:border-orange-700',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {!activeTicket && (
              <div className="mb-4 rounded-2xl border border-orange-100 dark:border-orange-900/40 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/20 p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-3 text-center">
                  How will the customer be ordering?
                </p>
                {isDineInMode ? (
                  <div className="grid grid-cols-2 gap-3">
                    {/* Eat-in — only visible in dine-in mode */}
                    <button
                      type="button"
                      onClick={handleStartEatIn}
                      aria-label="Start eat-in order — select a table"
                      className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl border-2 border-green-200 dark:border-green-800 bg-white dark:bg-gray-900 hover:bg-green-50 dark:hover:bg-green-950/40 hover:border-green-400 dark:hover:border-green-600 active:bg-green-100 dark:active:bg-green-950/70 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                    >
                      <Utensils className="w-10 h-10 text-green-600 dark:text-green-500" />
                      <span className="text-base font-bold text-gray-900 dark:text-white">Eat-in</span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {hasFloorPlan ? 'Select a table' : 'Set up tables first'}
                      </span>
                    </button>
                    {/* Takeaway */}
                    <button
                      type="button"
                      onClick={handleAddWalkIn}
                      aria-label="Start takeaway / walk-in order"
                      className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-white dark:bg-gray-900 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:border-orange-400 dark:hover:border-orange-600 active:bg-orange-100 dark:active:bg-orange-950/70 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                    >
                      <ShoppingBag className="w-10 h-10 text-orange-500" />
                      <span className="text-base font-bold text-gray-900 dark:text-white">Takeaway</span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">Walk-in / counter</span>
                    </button>
                  </div>
                ) : (
                  /* Takeaway-only mode: single wide button, no table flow */
                  <button
                    type="button"
                    onClick={handleAddWalkIn}
                    aria-label="Start a new order"
                    className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-white dark:bg-gray-900 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:border-orange-400 dark:hover:border-orange-600 active:bg-orange-100 dark:active:bg-orange-950/70 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                  >
                    <ShoppingBag className="w-10 h-10 text-orange-500" />
                    <span className="text-base font-bold text-gray-900 dark:text-white">New order</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">Tap to start serving</span>
                  </button>
                )}
              </div>
            )}
            {loadingMenu ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-40 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                  <Search className="w-7 h-7 text-gray-300 dark:text-gray-600" />
                </div>
                <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No items match</p>
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="mt-2 text-xs text-orange-500 hover:text-orange-600 underline"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredItems.map((it) => {
                  const remaining = computeRemainingToday(it, todayStr);
                  const soldOutToday = remaining !== null && remaining === 0;
                  const is86 = !!it.is_86ed;
                  const soldOut = soldOutToday || is86;
                  const isDisabled = !activeTicket || !canTakeOrders || soldOut;
                  const busy86 = toggling86 === it.id;
                  return (
                    <div key={it.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => handleAddItem(it)}
                        disabled={isDisabled}
                        aria-label={`Add ${it.name} — ${format(Math.round(parseFloat(it.price || 0) * scale))}${is86 ? ' (86 — sold out)' : soldOutToday ? ' (sold out)' : ''}`}
                        className={cn(
                          'flex w-full flex-col rounded-2xl bg-white dark:bg-gray-900 border-2 overflow-hidden text-left',
                          'transition-all duration-150',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1',
                          isDisabled
                            ? 'border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed shadow-none'
                            : 'border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg hover:border-orange-400 dark:hover:border-orange-600 hover:-translate-y-0.5 active:scale-95 active:shadow-sm',
                        )}
                      >
                        <div className="h-24 sm:h-28 flex items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100/60 dark:from-orange-950/40 dark:via-amber-950/30 dark:to-orange-900/30 relative">
                          <span className="text-4xl sm:text-5xl group-hover:scale-110 transition-transform duration-200 select-none">{emojiFor(it)}</span>
                          {is86 ? (
                            <span className="absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-600 text-white leading-none tracking-wide">
                              86&apos;d
                            </span>
                          ) : (
                            <ItemCountdownPill remaining={remaining} />
                          )}
                        </div>
                        <div className="flex-1 flex flex-col justify-between px-3 py-2.5">
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight">{it.name}</h3>
                          <div className="flex items-end justify-between mt-2">
                            <span className="text-base font-bold text-gray-900 dark:text-white tabular-nums">
                              {format(Math.round(parseFloat(it.price || 0) * scale))}
                            </span>
                            {!isDisabled && (
                              <span
                                aria-hidden="true"
                                className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:bg-orange-600 transition-all"
                              >
                                <Plus className="w-4 h-4" strokeWidth={2.5} />
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      {/* One-tap 86 toggle — sibling overlay (avoids nested buttons).
                          Hidden until hover/focus on pointer devices; the red "86'd"
                          badge already communicates state when active. */}
                      <button
                        type="button"
                        onClick={() => handleToggle86(it)}
                        disabled={busy86}
                        title={is86 ? 'Restore to menu' : '86 — mark sold out'}
                        aria-label={is86 ? `Restore ${it.name} to the menu` : `86 ${it.name} — mark sold out`}
                        className={cn(
                          'absolute top-1.5 right-1.5 z-10 inline-flex items-center justify-center rounded-full w-7 h-7 text-[10px] font-bold shadow-sm transition-all',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                          is86
                            ? 'bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-400'
                            : 'bg-card/90 text-muted-foreground border border-border opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus-visible:ring-destructive',
                          busy86 && 'opacity-60 cursor-wait',
                        )}
                      >
                        {is86 ? <RotateCcw className="w-3.5 h-3.5" strokeWidth={2.5} /> : '86'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Active ticket */}
        <ActiveTicketPanel
          ticket={activeTicket}
          newItems={activeTicket?.newItems || []}
          sentOrders={activeTicket?.sentOrders || []}
          onBumpQty={handleBumpQty}
          onRemoveItem={handleRemoveItem}
          onSend={handleSend}
          onCharge={handleOpenCharge}
          onAdjust={handleOpenAdjustment}
          onAdjustSuccess={() => {
            // Inline adjustment succeeded — refresh sent orders for the active ticket.
            toast({ title: 'Adjustment applied' });
          }}
          locationId={activeLocation?.id || ''}
          sending={sending}
          courses={courses}
          onSetCourse={handleSetCourse}
        />
      </main>

      {/* ============================== MODALS ============================== */}
      <OpenRegisterModal
        open={isOpenRegisterOpen}
        onOpenChange={setIsOpenRegisterOpen}
        locationId={activeLocation?.id || ''}
        onOpened={({ session }) => {
          setRegisterSession(session);
          setIsOpenRegisterOpen(false);
          toast({ title: 'Register opened', description: 'You can now take orders.' });
        }}
      />
      <ReturnModal
        open={isReturnOpen}
        onOpenChange={setIsReturnOpen}
        locationId={activeLocation?.id || ''}
        onSuccess={() => toast({ title: 'Return processed' })}
      />

      {/* Charge — method picker */}
      <Dialog open={showMethodPicker} onOpenChange={setShowMethodPicker}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>How is the customer paying?</DialogTitle>
            <DialogDescription>
              Total due: <span className="font-bold tabular-nums text-gray-900 dark:text-white">{format(activeUnpaidCents)}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <button
              type="button"
              onClick={() => handlePickMethod('cash')}
              aria-label="Pay with cash — numpad and change calculator"
              className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/60 hover:border-green-400 dark:hover:border-green-600 active:bg-green-200 dark:active:bg-green-950 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
            >
              <Banknote className="w-9 h-9 text-green-600 dark:text-green-500" />
              <span className="text-base font-bold text-gray-900 dark:text-white">Cash</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">Numpad + change calc</span>
            </button>
            <button
              type="button"
              onClick={() => handlePickMethod('card_in_person')}
              aria-label="Pay with card — external terminal"
              className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/60 hover:border-blue-400 dark:hover:border-blue-600 active:bg-blue-200 dark:active:bg-blue-950 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <CreditCard className="w-9 h-9 text-blue-600 dark:text-blue-500" />
              <span className="text-base font-bold text-gray-900 dark:text-white">Card</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">External terminal</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Charge — cash modal (legacy path, accessible via method picker) */}
      <CashTenderModal
        open={chargeMethod === 'cash'}
        onOpenChange={(o) => { if (!o) setChargeMethod(null); }}
        amountDueCents={activeUnpaidCents}
        submitting={chargeBusy}
        errorMessage={tenderError}
        onConfirm={({ tenderedCents, changeCents }) => {
          runCharge([{ method: 'cash', amountCents: tenderedCents, changeCents }]);
        }}
      />

      {/* Assign / move table picker — also used by the eat-in order-type selector
          when there is no active ticket yet. In that case we open a new table session
          directly via handleSelectTile instead of reassigning an existing ticket. */}
      <TablePickerDialog
        open={showTablePicker}
        onOpenChange={setShowTablePicker}
        tables={tableTiles}
        sections={sections}
        loading={tablesLoading || assigningTable}
        onSelect={(table) => {
          if (activeTicket) {
            handleAssignTable(table);
          } else {
            setShowTablePicker(false);
            handleSelectTile(table.id, 'table');
          }
        }}
      />

      {/* Charge — card modal (legacy path, accessible via method picker) */}
      <CardTenderModal
        open={chargeMethod === 'card_in_person'}
        onOpenChange={(o) => { if (!o) setChargeMethod(null); }}
        amountDueCents={activeUnpaidCents}
        submitting={chargeBusy}
        errorMessage={tenderError}
        onConfirm={({ amountCents, reference }) => {
          runCharge([{ method: 'card_in_person', amountCents, reference }]);
        }}
      />

      {/* Modifier picker — shown when an item with modifier_groups is tapped */}
      <ModifierPicker
        open={Boolean(modifierPickerItem)}
        onOpenChange={(o) => { if (!o) setModifierPickerItem(null); }}
        item={modifierPickerItem}
        onConfirm={({ selectedModifiers, extraCents, linePriceCents }) => {
          if (modifierPickerItem) {
            commitAddItem(modifierPickerItem, { selectedModifiers, extraCents, linePriceCents });
          }
          setModifierPickerItem(null);
        }}
      />

      {/* Adjustment modal — Void / Comp / Discount / Refund */}
      {adjustmentModal && (
        <AdjustmentModal
          open={Boolean(adjustmentModal)}
          onClose={() => setAdjustmentModal(null)}
          orderId={adjustmentModal.orderId}
          itemId={null}
          type={adjustmentModal.type}
          locationId={activeLocation?.id || ''}
          onSuccess={() => {
            setAdjustmentModal(null);
            toast({ title: 'Adjustment applied' });
          }}
        />
      )}

      {/* Split Tender modal — pay one ticket across multiple methods */}
      <TenderModal
        open={showTenderModal}
        onOpenChange={(o) => { if (!o) setShowTenderModal(false); }}
        totalCents={activeUnpaidCents}
        submitting={chargeBusy}
        errorMessage={tenderError}
        onConfirm={runCharge}
      />

      {/* Split-by-seat — dine-in check splitting per seat */}
      <SplitBySeat
        open={showSplitBySeat}
        onOpenChange={setShowSplitBySeat}
        ticket={activeTicket}
        onChargeSplit={handleChargeSplit}
        staffId={staff?.id || actor?.staff_id || undefined}
      />

      {/* Receipt modal — shown after a successful payment */}
      <ReceiptModal
        orderId={receiptOrderId}
        open={receiptOpen}
        onClose={() => {
          setReceiptOpen(false);
          setReceiptOrderId(null);
        }}
        onNewOrder={() => {
          setReceiptOpen(false);
          setReceiptOrderId(null);
          // Start a fresh walk-in ticket so the cashier can immediately take
          // the next order without any extra tap.
          handleAddWalkIn();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers used in render that aren't worth hooks
// ---------------------------------------------------------------------------

// `scale` is the active currency's minor units per major unit. Cart lines and
// order items carry major-unit decimals, so converting them with a literal 100
// misprices every currency that is not two-decimal.
function subtotalCentsOfTicket(t, scale) {
  if (!t) return 0;
  const newC = t.newItems.reduce(
    (sum, ni) => sum + Math.round((parseFloat(ni.price) || 0) * (ni.qty || 0) * scale),
    0,
  );
  const sentC = t.sentOrders.reduce((s, o) => {
    if (typeof o.total_cents === 'number') return s + o.total_cents;
    return s + (o.items || []).reduce((lc, it) => {
      if (typeof it.total_cents === 'number') return lc + it.total_cents;
      return lc + Math.round((parseFloat(it.unit_price || 0) * (it.quantity || 0)) * scale);
    }, 0);
  }, 0);
  return newC + sentC;
}
