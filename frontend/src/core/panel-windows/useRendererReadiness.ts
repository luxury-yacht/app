import { useEffect, useState } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';
import { acknowledgePanelWorkspaceReady, withdrawRendererReady } from './index';

const PAGE_KEY = 'luxury-yacht:renderer-page';

// A number for this page load that only grows for its window. The backend
// compares it across reloads: a call from the page before a reload can arrive
// after one from this page, and must not undo what this page said. The clock
// alone can step back, so the last number is kept for the window's session.
const takeRendererPage = (): number => {
  let last = 0;
  try {
    last = Number(globalThis.sessionStorage?.getItem(PAGE_KEY)) || 0;
  } catch {
    // Storage can be unavailable; the clock still orders the pages.
  }
  const page = Math.max(Date.now(), last + 1);
  try {
    globalThis.sessionStorage?.setItem(PAGE_KEY, String(page));
  } catch {
    // As above.
  }
  return page;
};

const rendererPage = takeRendererPage();

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

/**
 * Tells the backend that this page has started loading, before anything is
 * rendered. Whatever the page before a reload announced no longer holds: its
 * handlers are gone, and this page's are not subscribed yet.
 */
export const startRendererPage = (windowName: string): void =>
  sendInOrder('start-page', () => withdrawRendererReady(windowName, rendererPage));

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
    sendInOrder('announce', () => acknowledgePanelWorkspaceReady(windowName, rendererPage));
    return () => sendInOrder('withdraw', () => withdrawRendererReady(windowName, rendererPage));
  }, [windowName, reached]);
}
