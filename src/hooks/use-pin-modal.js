// use-pin-modal.js
//
// Provides two capabilities:
//
//   1. requestPin({ reason, isManagerOverride }) → Promise<actor|token>
//      Any component can imperatively trigger the PIN modal and await the result.
//
//   2. Auto-trigger: when `useActor().isExpired === true` AND the current route
//      is one that requires an actor (/pos/workspace, /q/:slug, /cash), the hook
//      opens the modal automatically so the user re-auths without losing work.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { useActor } from '@/context/actor-token-context';
import { usePinModalContext } from '@/components/pin-modal';

// Routes that require an active actor and should auto-prompt on expiry.
const ACTOR_REQUIRED_PATTERNS = [
  /^\/pos\/workspace/,
  /^\/q\//,
  /^\/cash$/,
];

function routeRequiresActor(pathname) {
  return ACTOR_REQUIRED_PATTERNS.some((re) => re.test(pathname));
}

/**
 * usePinModal()
 *
 * Returns { requestPin } which can be called to open the PIN modal.
 * Also auto-triggers when the actor expires on a protected route.
 *
 * Usage:
 *   const { requestPin } = usePinModal();
 *
 *   // Refresh own session:
 *   await requestPin({ reason: 'session expired' });
 *
 *   // Manager override for a single operation:
 *   const token = await requestPin({
 *     reason: 'void order',
 *     isManagerOverride: true,
 *   });
 *   await apiCallWithToken(token);
 */
export function usePinModal() {
  const { isExpired } = useActor();
  const { requestPin } = usePinModalContext();
  const location = useLocation();

  // Track whether we've already triggered a re-auth for this expiry event so we
  // don't open multiple modals if the component re-renders rapidly.
  const autoTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isExpired) {
      // Actor is active again (re-auth succeeded) — reset the guard.
      autoTriggeredRef.current = false;
      return;
    }

    if (autoTriggeredRef.current) return;
    if (!routeRequiresActor(location.pathname)) return;

    autoTriggeredRef.current = true;

    // Fire-and-forget: errors mean the user cancelled (they'll be navigated away
    // inside the modal's cancel handler).
    requestPin({ reason: 'session expired' }).catch(() => {
      // Cancelled — navigation handled by the modal itself.
    });
  }, [isExpired, location.pathname, requestPin]);

  return { requestPin };
}

export default usePinModal;
