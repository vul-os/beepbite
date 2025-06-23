import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';

const ProtectedRoute = ({ 
  children,
  redirectPath = '/signin',
  loadingComponent = (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg text-gray-500">Checking authorization...</div>
    </div>
  )
}) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    // Only redirect if we're sure loading is complete and user is not authenticated
    if (!loading && !user) {
      // Redirect to sign-in with the current location as state
      navigate(redirectPath, { 
        replace: true,
        state: { from: location }
      });
    }
  }, [user, loading, navigate, redirectPath]); // Removed location from dependencies

  // Show loading state while auth is being determined
  if (loading) {
    return loadingComponent;
  }

  // If no user and not loading, return null (redirect will happen in useEffect)
  if (!user) {
    return null;
  }

  // Only render children if user is authenticated
  return children;
};

export default ProtectedRoute;