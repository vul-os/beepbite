/**
 * LinkWhatsAppPage — WhatsApp number ↔ account binding flow.
 *
 * Route: /link-whatsapp/:token  (wired by orchestrator in routes.jsx)
 *
 * Behaviour:
 * - On mount, calls GET /link-whatsapp/{token} (public) to fetch the pending
 *   phone number.
 * - If the token is not found (404) or gone (410), shows an appropriate error.
 * - If the user is not signed in, shows a sign-in prompt.
 * - If the user is already at the 3-number cap, shows the manage-numbers view
 *   instead of the confirmation button.
 * - On "Add to my account", calls POST /link-whatsapp/{token} and shows
 *   success or an error.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Smartphone, CheckCircle, AlertCircle, Loader2, Phone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { useAuth } from '@/context/auth-context';
import { fetchPendingPhone, bindPhone, listLinkedNumbers } from '@/services/whatsapplink';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LinkWhatsAppPage() {
  const { token } = useParams();
  const { user } = useAuth();

  // Token / phone resolution
  const [pendingPhone, setPendingPhone] = useState(null);
  const [tokenError, setTokenError] = useState(null); // 'not_found' | 'gone' | 'error'
  const [loadingPhone, setLoadingPhone] = useState(true);

  // Binding state
  const [binding, setBinding] = useState(false);
  const [bindError, setBindError] = useState(null);
  const [bindSuccess, setBindSuccess] = useState(false);

  // Linked-numbers manage view
  const [links, setLinks] = useState(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [atCap, setAtCap] = useState(false);

  // ---------------------------------------------------------------------------
  // 1. Resolve the pending phone (public — no auth needed).
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!token) {
      setTokenError('not_found');
      setLoadingPhone(false);
      return;
    }

    setLoadingPhone(true);
    fetchPendingPhone(token).then(({ data, error }) => {
      setLoadingPhone(false);
      if (error) {
        if (error.status === 404) {
          setTokenError('not_found');
        } else if (error.status === 410) {
          setTokenError('gone');
        } else {
          setTokenError('error');
        }
      } else {
        setPendingPhone(data?.phone_e164 ?? null);
      }
    });
  }, [token]);

  // ---------------------------------------------------------------------------
  // 2. If the user is signed in, load their existing links.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!user) return;

    setLoadingLinks(true);
    listLinkedNumbers().then(({ data, error }) => {
      setLoadingLinks(false);
      if (!error && data?.links) {
        setLinks(data.links);
        setAtCap(data.links.length >= 3);
      }
    });
  }, [user]);

  // ---------------------------------------------------------------------------
  // 3. Bind handler.
  // ---------------------------------------------------------------------------

  async function handleBind() {
    if (!token || binding) return;
    setBinding(true);
    setBindError(null);

    const { data, error } = await bindPhone(token);
    setBinding(false);

    if (error) {
      if (error.status === 409) {
        // Could be cap or duplicate phone — re-fetch links to show manage view.
        setBindError(error.message || 'Unable to add number. You may already be at the 3-number limit.');
        listLinkedNumbers().then(({ data: ld }) => {
          if (ld?.links) {
            setLinks(ld.links);
            setAtCap(ld.links.length >= 3);
          }
        });
      } else if (error.status === 410) {
        setBindError('This link has expired or has already been used. Please request a new one.');
      } else if (error.status === 401) {
        setBindError('Please sign in to link your WhatsApp number.');
      } else {
        setBindError('Something went wrong. Please try again.');
      }
      return;
    }

    // Success — refresh links list.
    setBindSuccess(true);
    listLinkedNumbers().then(({ data: ld }) => {
      if (ld?.links) {
        setLinks(ld.links);
        setAtCap(ld.links.length >= 3);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loadingPhone) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading link details…</p>
        </div>
      </PageShell>
    );
  }

  if (tokenError) {
    const msg =
      tokenError === 'not_found'
        ? 'This link is invalid or has expired.'
        : tokenError === 'gone'
        ? 'This link has already been used or has expired. Please request a new one.'
        : 'Unable to load the link. Please try again.';

    return (
      <PageShell>
        <Alert variant="destructive" className="max-w-md mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="max-w-md mx-auto space-y-6">

        {/* ---- Phone confirmation card ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Smartphone className="h-5 w-5 text-primary" />
              Link WhatsApp Number
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingPhone && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                <Phone className="h-5 w-5 text-primary shrink-0" />
                <span className="font-mono text-base font-semibold tracking-wide">
                  {pendingPhone}
                </span>
              </div>
            )}

            {bindSuccess ? (
              <Alert className="border-success/30 bg-success/10 text-success">
                <CheckCircle className="h-4 w-4 text-success" />
                <AlertDescription>
                  <strong>{pendingPhone}</strong> has been added to your account.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {!user && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      You must be signed in to link a WhatsApp number to your account.
                    </AlertDescription>
                  </Alert>
                )}

                {bindError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{bindError}</AlertDescription>
                  </Alert>
                )}

                {user && !atCap && (
                  <Button
                    onClick={handleBind}
                    disabled={binding}
                    className="w-full"
                  >
                    {binding ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      'Add to my account'
                    )}
                  </Button>
                )}

                {user && atCap && !bindSuccess && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      You already have 3 linked numbers (the maximum). Remove one below to
                      add a new number.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ---- Manage linked numbers ---- */}
        {user && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your linked WhatsApp numbers</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLinks ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : links && links.length > 0 ? (
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="font-mono">{link.phone_e164}</span>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {new Date(link.bound_at).toLocaleDateString()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground py-2">
                  No WhatsApp numbers linked yet.
                </p>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Layout shell
// ---------------------------------------------------------------------------

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10">
        {children}
      </div>
    </div>
  );
}
