import React, { Suspense, lazy } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
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
  if (pathname.includes('/dashboard')) return 'Loading dashboard...';
  if (pathname.includes('/reports')) return 'Loading reports...';
  if (pathname.includes('/reviews')) return 'Loading reviews...';
  if (pathname.includes('/privacy')) return 'Loading privacy policy...';
  if (pathname.includes('/terms')) return 'Loading terms of service...';
  if (pathname.includes('/cookies')) return 'Loading cookie policy...';
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

// Lazy loaded components - App pages
const Dashboard = lazyImport(() => import('./pages/dashboard'));
const Reports = lazyImport(() => import('./pages/reports'));
const Reviews = lazyImport(() => import('./pages/reviews'));

// Lazy loaded components - Legal pages
const PrivacyPolicy = lazyImport(() => import('./pages/legal/privacy-policy'));
const TermsOfService = lazyImport(() => import('./pages/legal/terms-of-service'));
const CookiesPolicy = lazyImport(() => import('./pages/legal/cookies-policy'));

// Lazy loaded components - Documentation pages
const DocsIndex = lazyImport(() => import('./pages/docs/index'));

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
        </Route>

        {/* Public landing page and legal pages */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/cookies" element={<CookiesPolicy />} />
          <Route path="/docs" element={<DocsIndex />} />
        </Route>

        {/* Protected app routes */}
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={
            <Protected>
              <Dashboard />
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
        </Route>

        {/* Global catch-all route */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </CustomSuspense>
  );
};

export default AppRoutes;