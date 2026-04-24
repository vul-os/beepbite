import React, { Suspense, lazy } from 'react';
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
  if (pathname.includes('/menu/ai-menu-creator')) return 'Loading AI menu creator...';
  if (pathname.includes('/menu')) return 'Loading menu...';
  if (pathname.includes('/categories')) return 'Loading categories...';
  if (pathname.includes('/settings')) return 'Loading settings...';
  if (pathname.includes('/account')) return 'Loading account...';
  if (pathname.includes('/docs/privacy')) return 'Loading privacy policy...';
  if (pathname.includes('/docs/terms')) return 'Loading terms of service...';
  if (pathname.includes('/docs/cookies')) return 'Loading cookie policy...';
  if (pathname.includes('/docs/custom-avatar-url')) return 'Loading avatar guide...';
  if (pathname.includes('/docs/getting-started')) return 'Loading quick start...';
  if (pathname.includes('/docs/pos-overview')) return 'Loading POS guide...';
  if (pathname.includes('/docs/menu-management')) return 'Loading menu guide...';
  if (pathname.includes('/docs/whatsapp-setup')) return 'Loading WhatsApp guide...';
  if (pathname.includes('/docs')) return 'Loading documentation...';
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
const OAuthCallback = lazyImport(() => import('./pages/auth/oauth-callback'));

// Lazy loaded components - App pages
const Home = lazyImport(() => import('./pages/home'));
const Reports = lazyImport(() => import('./pages/reports'));
const Reviews = lazyImport(() => import('./pages/reviews'));
const Members = lazyImport(() => import('./pages/members'));
const Staff = lazyImport(() => import('./pages/staff'));
const Menu = lazyImport(() => import('./pages/menu'));
const Categories = lazyImport(() => import('./pages/categories'));
const AIMenuCreator = lazyImport(() => import('./pages/menu/ai-menu-creator'));
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
          <Route path="/auth/callback" element={<OAuthCallback />} />
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
          <Route path="/menu/ai-menu-creator" element={
            <Protected>
              <AIMenuCreator />
            </Protected>
          } />
          <Route path="/categories" element={
            <Protected>
              <Categories />
            </Protected>
          } />
          
          {/* Settings routes */}
          <Route path="/settings" element={<Navigate to="/settings/organization" replace />} />
          <Route path="/settings/organization" element={
            <Protected>
              <OrganizationSettings />
            </Protected>
          } />
          <Route path="/settings/location/:locationId" element={
            <Protected>
              <LocationSettings />
            </Protected>
          } />
          {/* Redirect old location settings route */}
          <Route path="/settings/location" element={<Navigate to="/settings/organization" replace />} />
          
          <Route path="/account" element={
            <Protected>
              <Account />
            </Protected>
          } />
        </Route>

        {/* 404 Route */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </CustomSuspense>
  );
};

export default AppRoutes;