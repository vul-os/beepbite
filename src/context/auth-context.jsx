import React, { useState, useEffect, useCallback, useMemo, useContext, createContext } from 'react';
import { supabase } from '@/services/supabase-client';

const AuthContext = createContext(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children, onNavigate, pathname }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bistros, setBistros] = useState([]);
  const [activeBistro, setActiveBistro] = useState(null);
  const [hasLoadedBistros, setHasLoadedBistros] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [hasLoadedInvites, setHasLoadedInvites] = useState(false);
  const [bistroSetupCompleted, setBistroSetupCompleted] = useState(true); // Default to true to avoid popup until checked

  const getBistroBySlug = useCallback((slug) => {
    return bistros.find(bistro => bistro.slug === slug);
  }, [bistros]);

  // Function to check if bistro setup is completed
  const checkBistroSetupCompleted = useCallback(async (bistroId) => {
    if (!bistroId) {
      setBistroSetupCompleted(true);
      return true;
    }
    
    try {
      const { data, error } = await supabase.rpc('check_bistro_setup_completed', {
        p_bistro_id: bistroId
      });
      
      if (error) {
        console.error('Error checking bistro setup completion:', error);
        setBistroSetupCompleted(true); // Default to true on error to avoid popup spam
        return true;
      }
      
      setBistroSetupCompleted(data);
      return data;
    } catch (error) {
      console.error('Error checking bistro setup completion:', error);
      setBistroSetupCompleted(true);
      return true;
    }
  }, []);

  const fetchBistros = useCallback(async () => {
    if (!user) {
      setHasLoadedBistros(true);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('bistros')
        .select(`
          *,
          bistro_members!inner(
            role,
            profile_id
          )
        `)
        .eq('bistro_members.profile_id', user.id);

      if (error) throw error;
      setBistros(data || []);
      if (data && data.length > 0 && !activeBistro) {
        setActiveBistro(data[0]);
      }
    } catch (error) {
      console.error('Error fetching bistros:', error);
    } finally {
      setHasLoadedBistros(true);
    }
  }, [user, activeBistro]);

  const switchBistro = useCallback((bistroId) => {
    const newActiveBistro = bistros.find(bistro => bistro.id === bistroId);
    if (newActiveBistro) {
      setActiveBistro(newActiveBistro);
    }
    return newActiveBistro;
  }, [bistros]);

  const switchBistroBySlug = useCallback((slug) => {
    const newActiveBistro = bistros.find(bistro => bistro.slug === slug);
    if (newActiveBistro) {
      setActiveBistro(newActiveBistro);
    }
  }, [bistros]);

  const handleAuthStateChange = useCallback((event, session) => {
    console.log('Auth state changed:', event);
    
    // Ignore INITIAL_SESSION events as they are often false positives
    // that can disrupt ongoing operations without meaningful state changes
    if (event === 'INITIAL_SESSION') {
      console.log('Ignoring INITIAL_SESSION event to prevent disruption');
      return;
    }
    
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (session?.user) {
        setUser({
          ...session.user,
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
        setHasLoadedBistros(false);
        setHasLoadedInvites(false);
        
        // Only navigate to search on manual sign-in, not on session restoration
        // We can distinguish this by checking if we're not currently on a protected route
        if (event === 'SIGNED_IN' && onNavigate && pathname && (pathname === '/signin' || pathname === '/signup' || pathname === '/')) {
          // Small delay to ensure user state is properly set
          setTimeout(() => {
            onNavigate('/dashboard');
          }, 100);
        }
      }
    } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      setUser(null);
      setBistros([]);
      setActiveBistro(null);
      setHasLoadedBistros(true);
      setPendingInvites([]);
      setHasLoadedInvites(true);
      setBistroSetupCompleted(true); // Reset setup state on signout
    } else if (event === 'USER_UPDATED') {
      setUser(prev => prev ? {
        ...session?.user,
        access_token: prev.access_token,
        refresh_token: prev.refresh_token
      } : null);
    }
  }, [onNavigate, pathname]);

  // Auth methods
  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw error;
    return data;
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data.user;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      }
    });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const forgotPassword = useCallback(async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, []);

  const updateUserPassword = useCallback(async (new_password) => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        throw new Error('No valid authentication session found. Please sign in again.');
      }

      const { data, error } = await supabase.auth.updateUser({
        password: new_password
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Password update failed:', error);
      return { data: null, error };
    }
  }, []);

  const fetchInvites = useCallback(async () => {
    if (!user) {
      setPendingInvites([]);
      setHasLoadedInvites(true);
      return;
    }
    
    try {
      const { data, error } = await supabase.rpc('check_invites');
      
      if (error) {
        console.error('Error fetching invites:', error);
        throw error;
      }
      
      setPendingInvites(data || []);
    } catch (error) {
      console.error('Error fetching invites:', error);
      setPendingInvites([]);
    } finally {
      setHasLoadedInvites(true);
    }
  }, [user]);

  const acceptInvite = useCallback(async (inviteId) => {
    try {
      // Get the bistro_id from the pending invite
      const currentInvite = pendingInvites.find(invite => invite.invite_id === inviteId);
      if (!currentInvite) {
        throw new Error('Invite not found');
      }

      const { data, error } = await supabase.rpc('respond_invitation', {
        p_bistro_id: currentInvite.bistro_id,
        p_accept: true
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to accept invitation');
      }
      
      // Refresh invites and bistros after accepting
      await Promise.all([fetchInvites(), fetchBistros()]);
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Error accepting invite:', error);
      return { success: false, error: error.message };
    }
  }, [pendingInvites, fetchInvites, fetchBistros]);

  const rejectInvite = useCallback(async (inviteId) => {
    try {
      // Get the bistro_id from the pending invite
      const currentInvite = pendingInvites.find(invite => invite.invite_id === inviteId);
      if (!currentInvite) {
        throw new Error('Invite not found');
      }

      const { data, error } = await supabase.rpc('respond_invitation', {
        p_bistro_id: currentInvite.bistro_id,
        p_accept: false
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to reject invitation');
      }
      
      // Refresh invites after rejecting
      await fetchInvites();
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Error rejecting invite:', error);
      return { success: false, error: error.message };
    }
  }, [pendingInvites, fetchInvites]);

  // Initialize auth state
  useEffect(() => {
    const initializeAuth = async () => {
      setLoading(true);
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Session error:', error);
          // Don't throw here, just log and continue
          setUser(null);
        } else if (session?.user) {
          setUser({
            ...session.user,
            access_token: session.access_token,
            refresh_token: session.refresh_token
          });
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange);
    return () => {
      subscription.unsubscribe();
    };
  }, [handleAuthStateChange]);

  // Fetch bistros when user changes
  useEffect(() => {
    if (!hasLoadedBistros) {
      fetchBistros();
    }
  }, [user, hasLoadedBistros, fetchBistros]);

  // Fetch invites when user changes  
  useEffect(() => {
    if (!hasLoadedInvites) {
      fetchInvites();
    }
  }, [user, hasLoadedInvites, fetchInvites]);

  // Check bistro setup completion when activeBistro changes
  useEffect(() => {
    if (activeBistro) {
      checkBistroSetupCompleted(activeBistro.id);
    }
  }, [activeBistro, checkBistroSetupCompleted]);

  // Add token refresh function
  const refreshToken = async () => {
    console.log("Attempting to refresh token...");
    try {
      // Check if we have a current session
      const { data: currentSession } = await supabase.auth.getSession();
      
      if (!currentSession?.session) {
        console.error("No active session to refresh");
        return null;
      }

      console.log("Current session exists, refreshing...");
      const { data, error } = await supabase.auth.refreshSession();
      
      if (error) {
        console.error("Token refresh error:", error.message);
        throw error;
      }
      
      if (data.session) {
        console.log("Session refreshed successfully");
        setUser({
          ...data.session.user,
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        });
        return data.session.access_token;
      } else {
        console.error("No session data returned after refresh");
        return null;
      }
    } catch (error) {
      console.error("Error refreshing token:", error.message);
      // Force sign out on critical errors
      await supabase.auth.signOut();
      setUser(null);
      return null;
    }
  };

  const contextValue = useMemo(() => ({
    loading,
    user,
    bistros,
    activeBistro,
    hasLoadedBistros,
    setHasLoadedBistros,
    pendingInvites,
    hasLoadedInvites,
    setHasLoadedInvites,
    bistroSetupCompleted,
    setBistroSetupCompleted,
    checkBistroSetupCompleted,
    switchBistro,
    switchBistroBySlug,
    getBistroBySlug,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    forgotPassword,
    updateUserPassword,
    fetchBistros,
    refreshToken,
    fetchInvites,
    acceptInvite,
    rejectInvite,
  }), [
    loading,
    user,
    bistros,
    activeBistro,
    hasLoadedBistros,
    pendingInvites,
    hasLoadedInvites,
    bistroSetupCompleted,
    checkBistroSetupCompleted,
    switchBistro,
    switchBistroBySlug,
    getBistroBySlug,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    forgotPassword,
    updateUserPassword,
    fetchBistros,
    refreshToken,
    fetchInvites,
    acceptInvite,
    rejectInvite,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;