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
  const [firms, setFirms] = useState([]);
  const [activeFirm, setActiveFirm] = useState(null);
  const [hasLoadedFirms, setHasLoadedFirms] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [hasLoadedInvites, setHasLoadedInvites] = useState(false);

  const getFirmBySlug = useCallback((slug) => {
    return firms.find(firm => firm.slug === slug);
  }, [firms]);

  const fetchFirms = useCallback(async () => {
    if (!user) {
      setHasLoadedFirms(true);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('firms')
        .select('*');

      if (error) throw error;
      setFirms(data || []);
      if (data && data.length > 0 && !activeFirm) {
        setActiveFirm(data[0]);
      }
    } catch (error) {
      console.error('Error fetching firms:', error);
    } finally {
      setHasLoadedFirms(true);
    }
  }, [user, activeFirm]);

  const switchFirm = useCallback((firmId) => {
    const newActiveFirm = firms.find(firm => firm.id === firmId);
    if (newActiveFirm) {
      setActiveFirm(newActiveFirm);
    }
    return newActiveFirm;
  }, [firms]);

  const switchFirmBySlug = useCallback((slug) => {
    const newActiveFirm = firms.find(firm => firm.slug === slug);
    if (newActiveFirm) {
      setActiveFirm(newActiveFirm);
    }
  }, [firms]);

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
        setHasLoadedFirms(false);
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
      setFirms([]);
      setActiveFirm(null);
      setHasLoadedFirms(true);
      setPendingInvites([]);
      setHasLoadedInvites(true);
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
      // Get the firm_id from the pending invite
      const currentInvite = pendingInvites.find(invite => invite.invite_id === inviteId);
      if (!currentInvite) {
        throw new Error('Invite not found');
      }

      const { data, error } = await supabase.rpc('respond_invitation', {
        p_firm_id: currentInvite.firm_id,
        p_accept: true
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to accept invitation');
      }
      
      // Refresh invites and firms after accepting
      await Promise.all([fetchInvites(), fetchFirms()]);
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Error accepting invite:', error);
      return { success: false, error: error.message };
    }
  }, [pendingInvites, fetchInvites, fetchFirms]);

  const rejectInvite = useCallback(async (inviteId) => {
    try {
      // Get the firm_id from the pending invite
      const currentInvite = pendingInvites.find(invite => invite.invite_id === inviteId);
      if (!currentInvite) {
        throw new Error('Invite not found');
      }

      const { data, error } = await supabase.rpc('respond_invitation', {
        p_firm_id: currentInvite.firm_id,
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

  // Fetch firms when user changes
  useEffect(() => {
    if (!hasLoadedFirms) {
      fetchFirms();
    }
  }, [user, hasLoadedFirms, fetchFirms]);

  // Fetch invites when user changes  
  useEffect(() => {
    if (!hasLoadedInvites) {
      fetchInvites();
    }
  }, [user, hasLoadedInvites, fetchInvites]);

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
    firms,
    activeFirm,
    hasLoadedFirms,
    setHasLoadedFirms,
    pendingInvites,
    hasLoadedInvites,
    setHasLoadedInvites,
    switchFirm,
    switchFirmBySlug,
    getFirmBySlug,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    forgotPassword,
    updateUserPassword,
    fetchFirms,
    refreshToken,
    fetchInvites,
    acceptInvite,
    rejectInvite,
  }), [
    loading,
    user,
    firms,
    activeFirm,
    hasLoadedFirms,
    pendingInvites,
    hasLoadedInvites,
    switchFirm,
    switchFirmBySlug,
    getFirmBySlug,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    forgotPassword,
    updateUserPassword,
    fetchFirms,
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