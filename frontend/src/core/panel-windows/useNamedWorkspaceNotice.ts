import { useEffect } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { onEvent } from '@/core/desktop-runtime';
import { errorHandler } from '@/utils/errorHandler';

const windows = (count: number) => (count === 1 ? '1 window' : `${count} windows`);

// One warning for each thing the switch could not do. They stay until
// dismissed: the workspace has already opened, so nothing else will say it.
const warningsFor = (event: panelwindow.NamedWorkspaceWarningsEvent) => {
  const warnings: { title: string; message: string }[] = [];
  if (event.missingClusters?.length) {
    warnings.push({
      title: 'Workspace opened with missing clusters',
      message: `Saved clusters unavailable: ${event.missingClusters.join(', ')}`,
    });
  }
  if (event.unclosedWindows > 0) {
    warnings.push({
      title: 'Workspace opened, but previous windows did not close',
      message: `${windows(event.unclosedWindows)} from before the switch could not be closed.`,
    });
  }
  if (event.unrestoredWindows > 0) {
    warnings.push({
      title: 'Workspace opened, but not every window was restored',
      message: `${windows(event.unrestoredWindows)} could not be opened or could not load the saved view.`,
    });
  }
  if (event.notFullscreen > 0) {
    warnings.push({
      title: 'Workspace opened, but not every window is fullscreen',
      message: `${windows(event.notFullscreen)} could not return to fullscreen.`,
    });
  }
  return warnings;
};

// Shows what a workspace switch could not do, in the window of the new
// workspace the backend chose: the window that asked is closed by it.
export function useNamedWorkspaceNotice(windowName: string) {
  useEffect(
    () =>
      onEvent('named-workspace:warnings', (event) => {
        if (event.windowName !== windowName) {
          return;
        }
        for (const { title, message } of warningsFor(event)) {
          errorHandler.warn(message, { title, autoDismiss: false });
        }
      }),
    [windowName]
  );
}
