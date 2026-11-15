import { useEffect } from 'react';
import { SubmitNamedWorkspaceCapture } from '@/core/backend-api';
import type { panelwindow } from '@/core/backend-api/models';
import { onEvent } from '@/core/desktop-runtime';
import { reportOperationalError } from '@/utils/errorHandler';

const NOTHING_CAPTURED: panelwindow.NamedWorkspaceAppView = { clusterTabs: null };

// An empty reason reads as success, so a failure always carries one.
export const workspaceFailureReason = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)) || 'The window could not respond';

// Answers this window's capture request with its view, or with the reason it
// has none, so the save fails at once instead of waiting out its deadline.
export function useNamedWorkspaceCapture(
  windowName: string,
  capture: () => Promise<panelwindow.NamedWorkspaceAppView>
) {
  useEffect(
    () =>
      onEvent('named-workspace:capture', (request) => {
        if (request.windowName !== windowName) {
          return;
        }
        void capture()
          .then(
            (view) => SubmitNamedWorkspaceCapture(windowName, request.id, view, ''),
            (error: unknown) =>
              SubmitNamedWorkspaceCapture(
                windowName,
                request.id,
                NOTHING_CAPTURED,
                workspaceFailureReason(error)
              )
          )
          .catch((error) =>
            reportOperationalError(error, { source: 'NamedWorkspace', action: 'captureWindow' })
          );
      }),
    [windowName, capture]
  );
}
