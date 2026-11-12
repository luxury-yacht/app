import { useEffect } from 'react';
import { SubmitNamedWorkspaceCapture } from '@/core/backend-api';
import { onEvent } from '@/core/desktop-runtime';
import { reportOperationalError } from '@/utils/errorHandler';

export function useNamedWorkspaceCapture(windowName: string, capture: () => Promise<object>) {
  useEffect(
    () =>
      onEvent('named-workspace:capture', (request) => {
        if (request.windowName !== windowName) {
          return;
        }
        void capture()
          .then((state) =>
            SubmitNamedWorkspaceCapture(windowName, request.id, JSON.stringify(state))
          )
          .catch((error) =>
            reportOperationalError(error, { source: 'NamedWorkspace', action: 'captureWindow' })
          );
      }),
    [windowName, capture]
  );
}
