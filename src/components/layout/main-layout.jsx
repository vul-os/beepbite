import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import TopBar from '../nav/top-bar';
import { onMissingCapability } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

const MainLayout = () => {
  const isMobile = useMediaQuery({ maxWidth: 640 });
  const location = useLocation();
  const { toast } = useToast();

  // Global handler: whenever the server returns 403 missing_capability, show a toast.
  useEffect(() => {
    const unsub = onMissingCapability((capability) => {
      toast({
        variant: 'destructive',
        title: 'Permission required',
        description: `You need the ${capability} permission. Ask a manager.`,
      });
    });
    return unsub;
  }, [toast]);
  const isLandingPage = location.pathname === '/';
  const isDocsPage = location.pathname === '/docs' || location.pathname.startsWith('/docs/');
  const isFullBleed = isLandingPage || isDocsPage;

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
    </div>
  );
};

export default MainLayout;