import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/auth-context';
import { ActorTokenProvider } from './context/actor-token-context';
import { PinModalProvider } from '@/components/pin-modal';
import AppRoutes from './routes';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/theme-provider';
import OnboardingPopup from '@/components/setup/onboarding-popup';

// Wrapper component that provides navigation functionality
const AuthWrapper = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <AuthProvider
      onNavigate={(path) => navigate(path, { replace: true })}
      pathname={location.pathname}
    >
      <ActorTokenProvider>
        <PinModalProvider>
          <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
            <AppRoutes />
            <OnboardingPopup />
            <Toaster />
          </ThemeProvider>
        </PinModalProvider>
      </ActorTokenProvider>
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