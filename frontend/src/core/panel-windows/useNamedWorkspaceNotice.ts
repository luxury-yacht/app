import { useEffect } from 'react';
import { onEvent } from '@/core/desktop-runtime';
import { errorHandler } from '@/utils/errorHandler';

export function useNamedWorkspaceNotice(windowName: string) {
  useEffect(
    () =>
      onEvent('named-workspace:missing-clusters', (event) => {
        if (event.windowName !== windowName || !event.clusters?.length) {
          return;
        }
        errorHandler.warn(`Saved clusters unavailable: ${event.clusters.join(', ')}`, {
          title: 'Workspace opened with missing clusters',
          autoDismiss: false,
        });
      }),
    [windowName]
  );
}
