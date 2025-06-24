import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import TopBar from '../nav/top-bar';

const TOP_BAR_HEIGHT = '4rem';

const MainLayout = () => {
  const isMobile = useMediaQuery({ maxWidth: 640 });
  const location = useLocation();
  const isLandingPage = location.pathname === '/';

  return (
    <div className="flex flex-col min-h-screen">
      <TopBar />
      
      <div className="flex flex-1" style={{ marginTop: TOP_BAR_HEIGHT }}>
        {isLandingPage ? (
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
    </div>
  );
};

export default MainLayout;