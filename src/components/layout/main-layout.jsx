import React from 'react';
import { Outlet } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import TopBar from '../nav/top-bar';

const TOP_BAR_HEIGHT = '4rem';

const MainLayout = () => {
  const isMobile = useMediaQuery({ maxWidth: 640 });

  return (
    <div className="flex flex-col h-screen">
      <TopBar />
      
      <div className="flex flex-1" style={{ marginTop: TOP_BAR_HEIGHT }}>
        <main className="flex-1 min-w-0 bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;