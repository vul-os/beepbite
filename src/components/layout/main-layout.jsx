import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import TopBar from '../nav/top-bar';
import BistroSetupPopup from '../setup/bistro-setup-popup';
import { useAuth } from '@/context/auth-context';

const TOP_BAR_HEIGHT = '4rem';

const MainLayout = () => {
  const isMobile = useMediaQuery({ maxWidth: 640 });
  const location = useLocation();
  const isLandingPage = location.pathname === '/';
  const isDocsPage = location.pathname === '/docs' || location.pathname.startsWith('/docs/');
  const isFullBleed = isLandingPage || isDocsPage;
  const { user, activeBistro, bistroSetupCompleted, loading } = useAuth();
  const [isSetupPopupOpen, setIsSetupPopupOpen] = useState(false);

  // Show setup popup when:
  // - User is logged in
  // - Has an active bistro
  // - Setup is not completed
  // - Not on landing page
  // - Auth is not loading
  const shouldShowSetupPopup = user && 
                                activeBistro && 
                                !bistroSetupCompleted && 
                                !isLandingPage && 
                                !loading;

  // Auto-open setup popup when conditions are met
  useEffect(() => {
    if (shouldShowSetupPopup) {
      setIsSetupPopupOpen(true);
    }
  }, [shouldShowSetupPopup]);

  const handleCloseSetupPopup = () => {
    setIsSetupPopupOpen(false);
    // Note: Users can close the popup, but it will reopen on page refresh
    // until setup is actually completed
  };

  return (
    <div className="flex flex-col min-h-screen">
      <TopBar />
      
      <div className={`flex flex-1 ${isLandingPage ? '' : `mt-16`}`}>
        {isFullBleed ? (
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        ) : (
          <main className="flex-1 min-w-0 bg-gray-50 px-2 sm:px-4 md:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto py-4 sm:py-6">
              <Outlet />
            </div>
          </main>
        )}
      </div>

      {/* Bistro Setup Popup */}
      <BistroSetupPopup 
        isOpen={isSetupPopupOpen}
        onClose={handleCloseSetupPopup}
      />
    </div>
  );
};

export default MainLayout;