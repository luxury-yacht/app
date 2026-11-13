import { useEffect, useState } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';
import { acknowledgePanelWorkspaceReady, withdrawRendererReady } from './index';

// The readiness call still on its way to the backend, if any. Each webview is
// its own JS realm, so one chain serves the one window.
let inFlight: Promise<void> | null = null;

// Sends a window's readiness calls in the order they were made, so a remount's
// announcement cannot land before the withdrawal that preceded it. With nothing
// in flight the call goes out at once.
const sendInOrder = (action: string, call: () => Promise<void>): void => {
  const sent = (inFlight ? inFlight.then(call) : call()).catch((error: unknown) => {
    reportOperationalError(error, { source: 'RendererReadiness', action });
  });
  inFlight = sent;
  void sent.then(() => {
    if (inFlight === sent) {
      inFlight = null;
    }
  });
};

/** Test helper: forgets a call a test left unanswered. */
export const resetRendererReadinessForTesting = (): void => {
  inFlight = null;
};

/**
 * Tells the backend when this window can answer the requests it sends to every
 * window (saving a workspace, switching workspace, the quit preflight), and
 * when it no longer can because the tree that owns those handlers unmounted,
 * as when the crash screen replaces it. Call it after the handlers' own hooks,
 * so they are subscribed before the announcement is sent.
 */
export function useRendererReadiness(windowName: string, ready: boolean): void {
  // Readiness is reached once. What signals it may flip back (kubeconfigs
  // reload), and that unsubscribes nothing.
  const [reached, setReached] = useState(false);
  if (ready && !reached) {
    setReached(true);
  }
  useEffect(() => {
    if (!reached) {
      return;
    }
    sendInOrder('announce', () => acknowledgePanelWorkspaceReady(windowName));
    return () => sendInOrder('withdraw', () => withdrawRendererReady(windowName));
  }, [windowName, reached]);
}
