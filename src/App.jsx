import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/auth-context';
import AppRoutes from './routes';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/theme-provider';
import usePageTracking from './hooks/usePageTracking';

// Wrapper component that provides navigation functionality
const AuthWrapper = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Track page views automatically
  usePageTracking();

  return (
    <AuthProvider 
      onNavigate={(path) => navigate(path, { replace: true })} 
      pathname={location.pathname}
    >
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <AppRoutes />
        <Toaster />
      </ThemeProvider>
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