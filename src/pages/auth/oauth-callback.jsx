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
      history.replaceState(null, '', window.location.pathname);
      navigate('/home', { replace: true });
    } else {
      navigate('/signin', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-orange-50 px-4">
      <div className="flex flex-col items-center gap-4">
        {/* Branded spinner */}
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
            <img src="/icon.svg" alt="" aria-hidden="true" className="w-8 h-8 filter brightness-0 invert" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-gray-600">
          <span className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span className="text-sm font-medium">Signing you in…</span>
        </div>
        <p className="text-xs text-gray-400">Please wait while we set up your session</p>
      </div>
    </div>
  );
}
