import { Suspense, lazy } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/auth/protected-route';

import { Progress as LoadingComponent } from './components/ui/progress';
// Layouts
import BlankLayout from './components/layout/blank-layout';
import MainLayout from './components/layout/main-layout';
import LandingPage from './pages/landing';

// Loading message mapping
const getLoadingMessage = (pathname) => {
  if (pathname.includes('/signin')) return 'Loading sign in...';
  if (pathname.includes('/signup')) return 'Loading sign up...';
  if (pathname.includes('/home')) return 'Loading home...';
  if (pathname.includes('/reports')) return 'Loading reports...';
  if (pathname.includes('/reviews')) return 'Loading reviews...';
  if (pathname.includes('/menu')) return 'Loading menu...';
  if (pathname.includes('/categories')) return 'Loading categories...';
  if (pathname.includes('/settings')) return 'Loading settings...';
  if (pathname.includes('/account')) return 'Loading account...';
  if (pathname.includes('/docs/privacy')) return 'Loading privacy policy...';
  if (pathname.includes('/docs/terms')) return 'Loading terms of service...';
  if (pathname.includes('/docs/cookies')) return 'Loading cookie policy...';
  if (pathname.includes('/docs/custom-avatar-url')) return 'Loading avatar guide...';
  if (pathname.includes('/docs/getting-started')) return 'Loading quick start...';
  if (pathname.startsWith('/s/')) return 'Loading store login...';
  if (pathname.startsWith('/q/')) return 'Loading Quick POS...';
  if (pathname.includes('/pos/workspace')) return 'Loading POS workspace...';
  if (pathname === '/work') return 'Loading kitchen workspace...';
  if (pathname.includes('/docs/pos-overview')) return 'Loading POS guide...';
  if (pathname.includes('/docs/menu-management')) return 'Loading menu guide...';
  if (pathname.includes('/docs/whatsapp-setup')) return 'Loading WhatsApp guide...';
  if (pathname.includes('/docs')) return 'Loading documentation...';
  if (pathname.startsWith('/store/')) return 'Loading store...';
  if (pathname.includes('/discover')) return 'Loading discover...';
  if (pathname.includes('/checkout')) return 'Loading checkout...';
  if (pathname === '/') return 'Loading homepage...';
  return 'Loading...';
};

// Custom Suspense wrapper with dynamic message
const CustomSuspense = ({ children }) => {
  const location = useLocation();
  const message = getLoadingMessage(location.pathname);
  
  return (
    <Suspense fallback={<LoadingComponent message={message} />}>
      {children}
    </Suspense>
  );
};

// Lazy imports
const lazyImport = (importFn) => {
  const Component = lazy(importFn);
  return Component;
};

// Lazy loaded components - Auth pages
const SignIn = lazyImport(() => import('./pages/auth/signin'));
const SignUp = lazyImport(() => import('./pages/auth/signup'));
const ForgotPassword = lazyImport(() => import('./pages/auth/forgot-password'));
const UpdatePassword = lazyImport(() => import('./pages/auth/update-password'));
const VerifyEmail = lazyImport(() => import('./pages/auth/verify-email'));

// Lazy loaded components - App pages
const Home = lazyImport(() => import('./pages/home'));
const Reports = lazyImport(() => import('./pages/reports'));
const Reviews = lazyImport(() => import('./pages/reviews'));
const Members = lazyImport(() => import('./pages/members'));
const Staff = lazyImport(() => import('./pages/staff'));
const Menu = lazyImport(() => import('./pages/menu'));
const Categories = lazyImport(() => import('./pages/categories'));
const Account = lazyImport(() => import('./pages/account'));

// Lazy loaded components - Settings pages
const OrganizationSettings = lazyImport(() => import('./pages/settings').then(module => ({ default: module.OrganizationSettings })));
const LocationSettings = lazyImport(() => import('./pages/settings').then(module => ({ default: module.LocationSettings })));

// Lazy loaded components - Documentation pages
const DocsIndex = lazyImport(() => import('./pages/docs/index'));
const DocsPrivacyPolicy = lazyImport(() => import('./pages/docs/privacy-policy'));
const DocsTermsOfService = lazyImport(() => import('./pages/docs/terms-of-service'));
const DocsCookiesPolicy = lazyImport(() => import('./pages/docs/cookies-policy'));
const DocsCustomAvatarUrl = lazyImport(() => import('./pages/docs/custom-avatar-url'));
const DocsGettingStarted = lazyImport(() => import('./pages/docs/getting-started'));
const DocsPosOverview = lazyImport(() => import('./pages/docs/pos-overview'));
const DocsMenuManagement = lazyImport(() => import('./pages/docs/menu-management'));
const DocsWhatsAppSetup = lazyImport(() => import('./pages/docs/whatsapp-setup'));

// Marketplace-scoped staff PIN login (/s/:slug)
const StaffPin = lazyImport(() => import('./pages/staff-pin'));

// POS / dine-in / KDS / payments / promotions / gift cards / etc.
const PosLogin = lazyImport(() => import('./pages/pos/login'));
const PosWorkspace = lazyImport(() => import('./pages/pos/workspace'));
const FloorLive = lazyImport(() => import('./pages/floor'));
const FloorEditor = lazyImport(() => import('./pages/floor/edit'));
const KdsStation = lazyImport(() => import('./pages/kds/station'));
const KdsExpo = lazyImport(() => import('./pages/kds/expo'));
// OrderAdjustmentsDemo removed — functionality now lives in the POS ticket panel (T11.4).
const Cash = lazyImport(() => import('./pages/cash'));
const SettingsLocationPayments = lazyImport(() => import('./pages/settings/location/payments'));
const SettingsPromotions = lazyImport(() => import('./pages/settings/promotions'));
const MenuSchedules = lazyImport(() => import('./pages/menu/schedules'));
const MenuCourses = lazyImport(() => import('./pages/menu/courses'));
const GiftCards = lazyImport(() => import('./pages/gift-cards'));
const HouseAccounts = lazyImport(() => import('./pages/house-accounts'));
const HouseAccountDetail = lazyImport(() => import('./pages/house-accounts/detail'));
const InventorySuppliers = lazyImport(() => import('./pages/inventory/suppliers'));
const InventoryPOs = lazyImport(() => import('./pages/inventory/purchase-orders'));
const InventoryAutoPO = lazyImport(() => import('./pages/inventory/auto-suggestions'));
const InventoryGRNs = lazyImport(() => import('./pages/inventory/grns'));
const InventoryInvoiceMatch = lazyImport(() => import('./pages/inventory/invoice-match'));
const SettingsApiKeys = lazyImport(() => import('./pages/settings/api-keys'));
const SettingsKitchen = lazyImport(() => import('./pages/settings/kitchen'));
const PlatformAdmin = lazyImport(() => import('./pages/admin'));
// Remaining-roadmap pages.
const LinkWhatsApp = lazyImport(() => import('./pages/link-whatsapp'));
const LegalTerms = lazyImport(() => import('./pages/legal/terms'));
const LegalPrivacy = lazyImport(() => import('./pages/legal/privacy'));
const CustomerChat = lazyImport(() => import('./pages/chat'));
const CustomerDisplay = lazyImport(() => import('./pages/pos/customer-display'));
const SettingsDomains = lazyImport(() => import('./pages/settings/domains'));
const SettingsHardware = lazyImport(() => import('./pages/settings/hardware'));
// Security (2FA) + Data & Privacy (export/delete) now live as tabs inside /account;
// the standalone routes below redirect there for backwards-compatible links.
const Invoices = lazyImport(() => import('./pages/invoices'));
const InvoiceDetail = lazyImport(() => import('./pages/invoices/detail'));
const InvoiceForm = lazyImport(() => import('./pages/invoices/form'));
const Workspace = lazyImport(() => import('./pages/work'));
const Onboard = lazyImport(() => import('./pages/onboard'));
const TimeClock = lazyImport(() => import('./pages/timeclock'));
const OwnerAssistant = lazyImport(() => import('./pages/assistant'));
const ManagerAudit = lazyImport(() => import('./pages/manager/audit'));
const AdminWANumbers = lazyImport(() => import('./pages/admin/wa-numbers'));
const SettingsDeliveryZones = lazyImport(() => import('./pages/settings/delivery-zones'));
const SettingsLoyalty = lazyImport(() => import('./pages/settings/loyalty/stamps-config'));
const SettingsLayout = lazyImport(() => import('./pages/settings/settings-layout'));
const ManagerDashboard = lazyImport(() => import('./pages/manager'));
const StaffManage = lazyImport(() => import('./pages/staff/manage'));
const Reservations = lazyImport(() => import('./pages/reservations'));
const Waitlist = lazyImport(() => import('./pages/waitlist'));

// Marketplace — public customer-facing pages
const Discover = lazyImport(() => import('./pages/discover'));
const StoreDetail = lazyImport(() => import('./pages/store/[slug]'));
const Checkout = lazyImport(() => import('./pages/checkout'));

// Quick POS — chrome-less counter-service kiosk at /q/:slug
const QuickPOS = lazyImport(() => import('./pages/quick-pos'));

// Drivers (Wave 16) — central driver portal + public customer live-tracking
const DriverPortal = lazyImport(() => import('./pages/driver'));
const CustomerTracking = lazyImport(() => import('./pages/track'));

// Other pages
const NotFound = lazyImport(() => import('./pages/not-found'));

const Protected = ({ children }) => (
  <ProtectedRoute>{children}</ProtectedRoute>
);

const AppRoutes = () => {
  return (
    <CustomSuspense>
      <Routes>
        {/* Public routes with blank layout */}
        <Route element={<BlankLayout />}>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/pos/login" element={<PosLogin />} />
          {/* Marketplace-scoped staff PIN login — public, no ProtectedRoute */}
          <Route path="/s/:slug" element={<StaffPin />} />
        </Route>

        {/* KDS station + expo screens run chrome-less for full-screen kitchen displays */}
        <Route element={<BlankLayout />}>
          <Route path="/kds/expo" element={<Protected><KdsExpo /></Protected>} />
          <Route path="/kds/:stationId" element={<Protected><KdsStation /></Protected>} />
          {/* Dedicated cashier POS workspace — chrome-less kiosk view */}
          <Route path="/pos/workspace" element={<Protected><PosWorkspace /></Protected>} />
        </Route>

        {/* Public routes with main layout */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/docs" element={<DocsIndex />} />
          <Route path="/docs/privacy" element={<DocsPrivacyPolicy />} />
          <Route path="/docs/terms" element={<DocsTermsOfService />} />
          <Route path="/docs/cookies" element={<DocsCookiesPolicy />} />
          <Route path="/docs/custom-avatar-url" element={<DocsCustomAvatarUrl />} />
          <Route path="/docs/getting-started" element={<DocsGettingStarted />} />
          <Route path="/docs/pos-overview" element={<DocsPosOverview />} />
          <Route path="/docs/menu-management" element={<DocsMenuManagement />} />
          <Route path="/docs/whatsapp-setup" element={<DocsWhatsAppSetup />} />

          {/* Legacy redirects for old legal routes */}
          <Route path="/privacy" element={<DocsPrivacyPolicy />} />
          <Route path="/terms" element={<DocsTermsOfService />} />
          <Route path="/cookies" element={<DocsCookiesPolicy />} />
        </Route>

        {/* Marketplace — public customer-facing routes (chrome-less) */}
        <Route element={<BlankLayout />}>
          <Route path="/discover" element={<Discover />} />
          <Route path="/store/:slug" element={<StoreDetail />} />
          <Route path="/checkout" element={<Checkout />} />
          {/* Quick POS kiosk — public, chrome-less, counter-service */}
          <Route path="/q/:slug" element={<QuickPOS />} />
          {/* Customer live order tracking — public, token-scoped */}
          <Route path="/track/:token" element={<CustomerTracking />} />
          {/* Central driver portal — requires sign-in, chrome-less (mobile) */}
          <Route path="/driver" element={<Protected><DriverPortal /></Protected>} />
          {/* Remaining-roadmap public/customer-facing surfaces */}
          <Route path="/link-whatsapp/:token" element={<Protected><LinkWhatsApp /></Protected>} />
          <Route path="/legal/terms" element={<LegalTerms />} />
          <Route path="/legal/privacy" element={<LegalPrivacy />} />
          <Route path="/chat" element={<Protected><CustomerChat /></Protected>} />
          <Route path="/pos/customer-display" element={<CustomerDisplay />} />
        </Route>

        {/* Protected app routes */}
        <Route element={<MainLayout />}>
          <Route path="/home" element={
            <Protected>
              <Home />
            </Protected>
          } />
          <Route path="/reports" element={
            <Protected>
              <Reports />
            </Protected>
          } />
          <Route path="/reviews" element={
            <Protected>
              <Reviews />
            </Protected>
          } />
          <Route path="/members" element={
            <Protected>
              <Members />
            </Protected>
          } />
          <Route path="/staff" element={
            <Protected>
              <Staff />
            </Protected>
          } />
          <Route path="/menu" element={
            <Protected>
              <Menu />
            </Protected>
          } />
          <Route path="/categories" element={
            <Protected>
              <Categories />
            </Protected>
          } />
          
          {/* Settings — all org-scoped admin pages share the SettingsLayout shell
              (grouped sidebar on the left, page in the right pane). Each child
              route renders inside the layout's <Outlet />. */}
          <Route path="/settings" element={<Protected><SettingsLayout /></Protected>}>
            <Route index element={<Navigate to="organization" replace />} />
            <Route path="organization" element={<OrganizationSettings />} />
            <Route path="location" element={<Navigate to="/settings/organization" replace />} />
            <Route path="location/:locationId" element={<LocationSettings />} />
            <Route path="location/:locationId/payments" element={<SettingsLocationPayments />} />
            <Route path="promotions" element={<SettingsPromotions />} />
            <Route path="api-keys" element={<SettingsApiKeys />} />
            <Route path="kitchen" element={<SettingsKitchen />} />
            <Route path="domains" element={<SettingsDomains />} />
            <Route path="hardware" element={<SettingsHardware />} />
            <Route path="delivery-zones" element={<SettingsDeliveryZones />} />
            <Route path="loyalty" element={<SettingsLoyalty />} />
            <Route path="security" element={<Navigate to="/account" replace />} />
            <Route path="business-info" element={<Navigate to="/settings/organization" replace />} />
            <Route path="account" element={<Navigate to="/account" replace />} />
          </Route>
          
          <Route path="/account" element={
            <Protected>
              <Account />
            </Protected>
          } />

          {/* Dine-in floor */}
          <Route path="/floor" element={<Protected><FloorLive /></Protected>} />
          <Route path="/floor/edit" element={<Protected><FloorEditor /></Protected>} />

          {/* Cash drawer + gift cards */}
          <Route path="/cash" element={<Protected><Cash /></Protected>} />
          <Route path="/gift-cards" element={<Protected><GiftCards /></Protected>} />
          {/* /dev/adjustments removed — inline adjustment menu lives in the POS ticket panel (T11.4) */}

          {/* Menu schedules */}
          <Route path="/menu/schedules" element={<Protected><MenuSchedules /></Protected>} />

          {/* Menu courses — kitchen fire course management (Wave 11) */}
          <Route path="/menu/courses" element={<Protected><MenuCourses /></Protected>} />

          {/* Admin — separate from /settings (platform-admin scope, not org). */}
          <Route path="/admin" element={<Protected><PlatformAdmin /></Protected>} />
          <Route path="/admin/wa-numbers" element={<Protected><AdminWANumbers /></Protected>} />
          <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
          <Route path="/invoices/new" element={<Protected><InvoiceForm /></Protected>} />
          <Route path="/invoices/:id" element={<Protected><InvoiceDetail /></Protected>} />
          <Route path="/invoices/:id/edit" element={<Protected><InvoiceForm /></Protected>} />
          <Route path="/work" element={<Protected><Workspace /></Protected>} />
          <Route path="/onboard" element={<Protected><Onboard /></Protected>} />
          <Route path="/timeclock" element={<Protected><TimeClock /></Protected>} />
          <Route path="/assistant" element={<Protected><OwnerAssistant /></Protected>} />
          <Route path="/manager/audit" element={<Protected><ManagerAudit /></Protected>} />

          {/* House accounts */}
          <Route path="/house-accounts" element={<Protected><HouseAccounts /></Protected>} />
          <Route path="/house-accounts/:id" element={<Protected><HouseAccountDetail /></Protected>} />

          {/* Inventory + procurement */}
          <Route path="/inventory/suppliers" element={<Protected><InventorySuppliers /></Protected>} />
          <Route path="/inventory/purchase-orders" element={<Protected><InventoryPOs /></Protected>} />
          <Route path="/inventory/purchase-orders/auto-suggestions" element={<Protected><InventoryAutoPO /></Protected>} />
          <Route path="/inventory/grns" element={<Protected><InventoryGRNs /></Protected>} />
          <Route path="/inventory/invoice-match" element={<Protected><InventoryInvoiceMatch /></Protected>} />

          {/* Manager + staff + reservations + delivery zones */}
          <Route path="/manager" element={<Protected><ManagerDashboard /></Protected>} />
          <Route path="/staff/manage" element={<Protected><StaffManage /></Protected>} />
          <Route path="/reservations" element={<Protected><Reservations /></Protected>} />
          <Route path="/waitlist" element={<Protected><Waitlist /></Protected>} />
        </Route>

        {/* 404 Route */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </CustomSuspense>
  );
};

export default AppRoutes;