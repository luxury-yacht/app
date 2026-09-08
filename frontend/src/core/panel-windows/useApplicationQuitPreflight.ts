import { useEffect, useRef } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  acknowledgeApplicationQuitPreflight,
  onApplicationQuitPreflightRequested,
  onApplicationQuitPreflightSettled,
} from './index';
import { usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';

export function useApplicationQuitPreflight(
  windowName: string,
  prepare: (transactionId: string, status: string) => Promise<boolean>
) {
  const guards = usePanelLifecycleGuardRegistry();
  const settled = useRef(new Set<string>());
  useEffect(() => {
    const stopRequested = onApplicationQuitPreflightRequested((event) => {
      if (event.windowName !== windowName || settled.current.has(event.transactionId)) {
        return;
      }
      void prepare(event.transactionId, 'Closing application…')
        .catch((error) => {
          reportOperationalError(error, { source: 'ApplicationQuitPreflight', action: 'prepare' });
          return false;
        })
        .then((allowed) => {
          if (!allowed) {
            guards.releaseTransfer(event.transactionId);
          }
          if (settled.current.has(event.transactionId)) {
            return;
          }
          return acknowledgeApplicationQuitPreflight(windowName, event.transactionId, allowed);
        })
        .catch((error) => {
          guards.releaseTransfer(event.transactionId);
          reportOperationalError(error, {
            source: 'ApplicationQuitPreflight',
            action: 'acknowledge',
          });
        });
    });
    const stopSettled = onApplicationQuitPreflightSettled((event) => {
      if (event.windowName === windowName) {
        settled.current.add(event.transactionId);
        guards.releaseTransfer(event.transactionId);
      }
    });
    return () => {
      stopRequested();
      stopSettled();
    };
  }, [windowName, prepare, guards]);
}
