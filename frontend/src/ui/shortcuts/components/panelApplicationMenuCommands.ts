import { backend } from '@/core/backend-api/models';

export interface PanelApplicationMenuActions {
  close: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  minimise: () => void;
  maximise: () => void;
  restore: () => void;
  toggleMaximise: () => void;
  openInspector: () => void;
}

const command = backend.ApplicationMenuCommand;

const localActionByCommand: Partial<
  Record<backend.ApplicationMenuCommand, keyof PanelApplicationMenuActions>
> = {
  [command.ApplicationMenuCommandClose]: 'close',
  [command.ApplicationMenuCommandZoomIn]: 'zoomIn',
  [command.ApplicationMenuCommandZoomOut]: 'zoomOut',
  [command.ApplicationMenuCommandZoomReset]: 'zoomReset',
  [command.ApplicationMenuCommandMinimise]: 'minimise',
  [command.ApplicationMenuCommandMaximise]: 'maximise',
  [command.ApplicationMenuCommandRestore]: 'restore',
  [command.ApplicationMenuCommandToggleMaximise]: 'toggleMaximise',
  [command.ApplicationMenuCommandOpenInspector]: 'openInspector',
};

export const dispatchPanelApplicationMenuCommand = (
  menuCommand: backend.ApplicationMenuCommand,
  actions: PanelApplicationMenuActions
): boolean => {
  const action = localActionByCommand[menuCommand];
  if (!action) {
    return false;
  }
  actions[action]();
  return true;
};
