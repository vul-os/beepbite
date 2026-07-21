import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/auth-context';
import { ActorTokenProvider } from './context/actor-token-context';
import { PinModalProvider } from '@/components/pin-modal';
import AppRoutes from './routes';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/theme-provider';
import OnboardingPopup from '@/components/setup/onboarding-popup';
import { LocaleProvider } from '@/context/locale-context';
import { useAuth } from './context/auth-context';

// Bridges the active location into the locale layer.
//
// Currency, locale, timezone and tax posture are properties of the LOCATION a
// user is working in, not of the app or the user, so the provider has to sit
// inside AuthProvider (which owns activeLocation) and re-supply itself whenever
// the operator switches branch. A multi-branch operator with a Lisbon and a
// Tokyo store must see euros and 23% IVA on one and yen and 10% consumption tax
// on the other, without reloading.
//
// When no location is active — signed out, or mid-load — the provider falls
// back to its neutral defaults: no currency, UTC, no tax. Amounts then render
// as bare numbers, which reads as "not configured yet" rather than silently
// picking a country.
const LocaleBridge = ({ children }) => {
  const { activeLocation } = useAuth();
  return <LocaleProvider location={activeLocation}>{children}</LocaleProvider>;
};

// Wrapper component that provides navigation functionality
const AuthWrapper = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <AuthProvider
      onNavigate={(path) => navigate(path, { replace: true })}
      pathname={location.pathname}
    >
      <LocaleBridge>
        <ActorTokenProvider>
          <PinModalProvider>
            <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
              <AppRoutes />
              <OnboardingPopup />
              <Toaster />
            </ThemeProvider>
          </PinModalProvider>
        </ActorTokenProvider>
      </LocaleBridge>
    </AuthProvider>
  );
};

// Main App component
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/*" element={<AuthWrapper />} />
      </Routes>
    </Router>
  );
}

export default App;