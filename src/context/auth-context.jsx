import { useState, useEffect, useCallback, useMemo, useContext, createContext } from 'react';
import { supabase } from '@/services/supabase-client';

const AuthContext = createContext(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper functions for localStorage
const getStoredActiveOrganization = () => {
  try {
    const stored = localStorage.getItem('activeOrganization');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Error parsing stored active organization:', error);
    return null;
  }
};

const setStoredActiveOrganization = (organization) => {
  try {
    if (organization) {
      localStorage.setItem('activeOrganization', JSON.stringify(organization));
    } else {
      localStorage.removeItem('activeOrganization');
    }
  } catch (error) {
    console.error('Error storing active organization:', error);
  }
};

const getStoredActiveLocation = () => {
  try {
    const stored = localStorage.getItem('activeLocation');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Error parsing stored active location:', error);
    return null;
  }
};

const setStoredActiveLocation = (location) => {
  try {
    if (location) {
      localStorage.setItem('activeLocation', JSON.stringify(location));
    } else {
      localStorage.removeItem('activeLocation');
    }
  } catch (error) {
    console.error('Error storing active location:', error);
  }
};

export function AuthProvider({ children, onNavigate, pathname }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState([]);
  const [activeOrganization, setActiveOrganization] = useState(null);
  const [locations, setLocations] = useState([]);
  const [activeLocation, setActiveLocation] = useState(null);
  const [hasLoadedOrganizations, setHasLoadedOrganizations] = useState(false);
  const [hasLoadedLocations, setHasLoadedLocations] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [hasLoadedInvites, setHasLoadedInvites] = useState(false);
  // needsOnboarding: true only after orgs have finished loading and the user has none
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Helper function to update active organization with localStorage
  const updateActiveOrganization = useCallback((organization) => {
    setActiveOrganization(organization);
    setStoredActiveOrganization(organization);
  }, []);

  // Helper function to update active location with localStorage
  const updateActiveLocation = useCallback((location) => {
    setActiveLocation(location);
    setStoredActiveLocation(location);
  }, []);

  const getOrganizationBySlug = useCallback((slug) => {
    return organizations.find(organization => organization.slug === slug);
  }, [organizations]);

  const fetchUserProfile = useCallback(async () => {
    if (!user?.id) {
      setUserProfile(null);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (error) {
        console.error('Error fetching user profile:', error);
        setUserProfile(null);
        return;
      }
      
      setUserProfile(data);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      setUserProfile(null);
    }
  }, [user?.id]);

  const fetchOrganizations = useCallback(async () => {
    if (!user) {
      // Do NOT flip hasLoadedOrganizations true here — that would cause the
      // user-state-change useEffect to skip the real fetch once user resolves.
      setOrganizations([]);
      setNeedsOnboarding(false);
      return;
    }

    try {
      // Fetch only the organisations this user is a member of.
      // The Go data layer has no RLS, so we drive tenancy from the client:
      //   1. Get the membership rows for this profile.
      //   2. If there are none, the user has no orgs — trigger onboarding.
      //   3. Otherwise IN-query only those org IDs.
      const { data: memberRows, error: memberError } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('profile_id', user.id);

      if (memberError) throw memberError;

      const orgIds = (memberRows || []).map((m) => m.organization_id).filter(Boolean);

      let orgs = [];
      if (orgIds.length > 0) {
        const { data: orgRows, error: orgError } = await supabase
          .from('organizations')
          .select('*')
          .in('id', orgIds)
          .eq('is_active', true);
        if (orgError) throw orgError;
        orgs = orgRows || [];
      }
      setOrganizations(orgs);
      // Trigger onboarding popup when user has no organisations.
      setNeedsOnboarding(orgs.length === 0);

      const storedOrganization = getStoredActiveOrganization();
      if (storedOrganization && orgs.find((o) => o.id === storedOrganization.id)) {
        updateActiveOrganization(storedOrganization);
      } else if (orgs.length > 0) {
        updateActiveOrganization(orgs[0]);
      } else {
        updateActiveOrganization(null);
      }
    } catch (error) {
      console.error('Error fetching organizations:', error);
      // On error treat as no orgs so onboarding still surfaces — better UX
      // than the user staring at a topbar with no popup and no recovery path.
      setOrganizations([]);
      setNeedsOnboarding(true);
    } finally {
      setHasLoadedOrganizations(true);
    }
  }, [user, updateActiveOrganization]);

  const fetchLocations = useCallback(async () => {
    if (!activeOrganization) {
      setLocations([]);
      setActiveLocation(null);
      setStoredActiveLocation(null);
      setHasLoadedLocations(true);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', activeOrganization.id)
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      setLocations(data || []);
      
      // Set active location from localStorage or default to first location
      const storedLocation = getStoredActiveLocation();
      if (storedLocation && data?.find(l => l.id === storedLocation.id && l.organization_id === activeOrganization.id)) {
        updateActiveLocation(storedLocation);
      } else if (data && data.length > 0) {
        // Always set first location if no valid stored one exists
        updateActiveLocation(data[0]);
      } else {
        // No locations found, clear active location
        updateActiveLocation(null);
      }
    } catch (error) {
      console.error('Error fetching locations:', error);
      setLocations([]);
      updateActiveLocation(null);
    } finally {
      setHasLoadedLocations(true);
    }
  }, [activeOrganization, updateActiveLocation]);

  const switchOrganization = useCallback((organizationId) => {
    const newActiveOrganization = organizations.find(organization => organization.id === organizationId);
    if (newActiveOrganization) {
      updateActiveOrganization(newActiveOrganization);
      // Reset location when switching organization
      setActiveLocation(null);
      setStoredActiveLocation(null);
      setLocations([]);
      setHasLoadedLocations(false);
    }
    return newActiveOrganization;
  }, [organizations, updateActiveOrganization]);

  const switchOrganizationBySlug = useCallback((slug) => {
    const newActiveOrganization = organizations.find(organization => organization.slug === slug);
    if (newActiveOrganization) {
      updateActiveOrganization(newActiveOrganization);
      // Reset location when switching organization
      setActiveLocation(null);
      setStoredActiveLocation(null);
      setLocations([]);
      setHasLoadedLocations(false);
    }
  }, [organizations, updateActiveOrganization]);

  const switchLocation = useCallback((locationId) => {
    const newActiveLocation = locations.find(location => location.id === locationId);
    if (newActiveLocation) {
      updateActiveLocation(newActiveLocation);
    }
    return newActiveLocation;
  }, [locations, updateActiveLocation]);

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
        setHasLoadedOrganizations(false);
        setHasLoadedLocations(false);
        setHasLoadedInvites(false);
        
        // Redirect to dashboard after successful sign in. /home is the
        // authenticated landing; / is the marketing landing page.
        if (
          event === 'SIGNED_IN' &&
          onNavigate &&
          pathname &&
          (pathname === '/signin' ||
            pathname === '/signup' ||
            pathname === '/auth/callback' ||
            pathname === '/verify-email')
        ) {
          setTimeout(() => {
            onNavigate('/home');
          }, 100);
        }
      }
    } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      setUser(null);
      setUserProfile(null);
      setOrganizations([]);
      setActiveOrganization(null);
      setLocations([]);
      setActiveLocation(null);
      setHasLoadedOrganizations(true);
      setHasLoadedLocations(true);
      setPendingInvites([]);
      setHasLoadedInvites(true);
      setNeedsOnboarding(false); // Reset onboarding state on signout
      
      // Clear localStorage on signout
      setStoredActiveOrganization(null);
      setStoredActiveLocation(null);
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
      const { data, error } = await supabase.rpc('check_invites', { p_user_id: user.id });
      
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
      // Get the organization_id from the pending invite
      const currentInvite = pendingInvites.find(invite => invite.invite_id === inviteId);
      if (!currentInvite) {
        throw new Error('Invite not found');
      }

      const { data, error } = await supabase.rpc('respond_invitation', {
        p_user_id: user.id,
        p_invite_id: currentInvite.invite_id,
        p_accept: true
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to accept invitation');
      }
      
      // Refresh invites and organizations after accepting
      await Promise.all([fetchInvites(), fetchOrganizations()]);
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Error accepting invite:', error);
      return { success: false, error: error.message };
    }
  }, [pendingInvites, fetchInvites, fetchOrganizations]);

  const rejectInvite = useCallback(async (inviteId) => {
    try {
      // Get the organization_id from the pending invite
      const currentInvite = pendingInvites.find(invite => invite.invite_id === inviteId);
      if (!currentInvite) {
        throw new Error('Invite not found');
      }

      const { data, error } = await supabase.rpc('respond_invitation', {
        p_user_id: user.id,
        p_invite_id: currentInvite.invite_id,
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

  // Fetch organizations when user changes
  useEffect(() => {
    if (!hasLoadedOrganizations) {
      fetchOrganizations();
    }
  }, [user, hasLoadedOrganizations, fetchOrganizations]);

  // Fetch locations when active organization changes
  useEffect(() => {
    if (!hasLoadedLocations) {
      fetchLocations();
    }
  }, [activeOrganization, hasLoadedLocations, fetchLocations]);

  // Dedicated effect for when activeOrganization changes - always fetch locations
  useEffect(() => {
    if (activeOrganization) {
      console.log('Active organization changed, fetching locations for:', activeOrganization.name);
      setHasLoadedLocations(false);
    }
  }, [activeOrganization?.id]); // Only depend on ID to avoid unnecessary re-renders

  // Fetch user profile when user changes
  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

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
    userProfile,
    organizations,
    activeOrganization,
    locations,
    activeLocation,
    hasLoadedOrganizations,
    setHasLoadedOrganizations,
    hasLoadedLocations,
    setHasLoadedLocations,
    pendingInvites,
    hasLoadedInvites,
    setHasLoadedInvites,
    needsOnboarding,
    switchOrganization,
    switchOrganizationBySlug,
    switchLocation,
    getOrganizationBySlug,
    signUp,
    signIn,
    signOut,
    forgotPassword,
    updateUserPassword,
    fetchOrganizations,
    fetchLocations,
    refreshToken,
    fetchInvites,
    acceptInvite,
    rejectInvite,
    fetchUserProfile,
  }), [
    loading,
    user,
    userProfile,
    organizations,
    activeOrganization,
    locations,
    activeLocation,
    hasLoadedOrganizations,
    hasLoadedLocations,
    pendingInvites,
    hasLoadedInvites,
    needsOnboarding,
    switchOrganization,
    switchOrganizationBySlug,
    switchLocation,
    getOrganizationBySlug,
    signUp,
    signIn,
    signOut,
    forgotPassword,
    updateUserPassword,
    fetchOrganizations,
    fetchLocations,
    refreshToken,
    fetchInvites,
    acceptInvite,
    rejectInvite,
    fetchUserProfile,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;