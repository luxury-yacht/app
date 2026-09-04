import { backend } from '@/core/backend-api/models';

export interface WorkspaceApplicationMenuActions {
  close: () => void;
  openCluster: () => void;
  toggleSettings: () => void;
  openCommandPalette: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  toggleSidebar: () => void;
  toggleObjectDiff: () => void;
  toggleAppLogs: () => void;
  toggleDiagnostics: () => void;
  openInspector: () => void;
  toggleFocusDebug: () => void;
  togglePanelDebug: () => void;
  toggleMapDebug: () => void;
  toggleIconDebug: () => void;
  toggleErrorDebug: () => void;
  openAbout: () => void;
}

const command = backend.ApplicationMenuCommand;

const localActionByCommand: Partial<
  Record<backend.ApplicationMenuCommand, keyof WorkspaceApplicationMenuActions>
> = {
  [command.ApplicationMenuCommandClose]: 'close',
  [command.ApplicationMenuCommandOpenCluster]: 'openCluster',
  [command.ApplicationMenuCommandSettings]: 'toggleSettings',
  [command.ApplicationMenuCommandCommandPalette]: 'openCommandPalette',
  [command.ApplicationMenuCommandZoomIn]: 'zoomIn',
  [command.ApplicationMenuCommandZoomOut]: 'zoomOut',
  [command.ApplicationMenuCommandZoomReset]: 'zoomReset',
  [command.ApplicationMenuCommandToggleSidebar]: 'toggleSidebar',
  [command.ApplicationMenuCommandToggleObjectDiff]: 'toggleObjectDiff',
  [command.ApplicationMenuCommandToggleAppLogs]: 'toggleAppLogs',
  [command.ApplicationMenuCommandToggleDiagnostics]: 'toggleDiagnostics',
  [command.ApplicationMenuCommandOpenInspector]: 'openInspector',
  [command.ApplicationMenuCommandToggleFocusDebug]: 'toggleFocusDebug',
  [command.ApplicationMenuCommandTogglePanelDebug]: 'togglePanelDebug',
  [command.ApplicationMenuCommandToggleMapDebug]: 'toggleMapDebug',
  [command.ApplicationMenuCommandToggleIconDebug]: 'toggleIconDebug',
  [command.ApplicationMenuCommandToggleErrorDebug]: 'toggleErrorDebug',
  [command.ApplicationMenuCommandAbout]: 'openAbout',
};

export const dispatchWorkspaceApplicationMenuCommand = (
  menuCommand: backend.ApplicationMenuCommand,
  actions: WorkspaceApplicationMenuActions
): boolean => {
  const action = localActionByCommand[menuCommand];
  if (!action) {
    return false;
  }
  actions[action]();
  return true;
};
