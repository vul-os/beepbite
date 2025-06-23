import React from 'react';
import { useLocation } from 'react-router-dom';
import { analytics, logEvent } from '../services/firebase';

// Custom hook to track page views on route changes
const usePageTracking = () => {
  const location = useLocation();

  React.useEffect(() => {
    logEvent(analytics, 'page_view', {
      page_path: location.pathname,
      page_search: location.search,
      page_title: document.title,
    });
  }, [location]);
};

export default usePageTracking; 