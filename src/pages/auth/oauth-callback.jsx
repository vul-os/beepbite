import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/api-client';

// Handles the Google OAuth redirect. The Go backend appends access + refresh
// tokens as a URL fragment (#access_token=…&refresh_token=…). We ingest them,
// persist a session, and send the user to /home.
export default function OAuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const session = supabase.auth._ingestOAuthFragment(window.location.hash);
    if (session) {
      // Remove the fragment from the address bar before navigating.
      history.replaceState(null, '', window.location.pathname);
      navigate('/home', { replace: true });
    } else {
      navigate('/signin', { replace: true });
    }
  }, [navigate]);

  return (
    <div style={{ padding: 24 }}>Signing you in…</div>
  );
}
