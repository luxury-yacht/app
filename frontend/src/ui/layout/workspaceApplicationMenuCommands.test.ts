import { describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  dispatchWorkspaceApplicationMenuCommand,
  type WorkspaceApplicationMenuActions,
} from './workspaceApplicationMenuCommands';

const command = backend.ApplicationMenuCommand;

describe('dispatchWorkspaceApplicationMenuCommand', () => {
  it('executes every renderer-owned workspace command locally', () => {
    const actions: WorkspaceApplicationMenuActions = {
      close: vi.fn(),
      openCluster: vi.fn(),
      toggleSettings: vi.fn(),
      openCommandPalette: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
      toggleSidebar: vi.fn(),
      toggleObjectDiff: vi.fn(),
      toggleAppLogs: vi.fn(),
      toggleDiagnostics: vi.fn(),
      openInspector: vi.fn(),
      toggleFocusDebug: vi.fn(),
      togglePanelDebug: vi.fn(),
      toggleMapDebug: vi.fn(),
      toggleIconDebug: vi.fn(),
      toggleErrorDebug: vi.fn(),
      openAbout: vi.fn(),
    };
    const mappings: Array<[backend.ApplicationMenuCommand, keyof WorkspaceApplicationMenuActions]> =
      [
        [command.ApplicationMenuCommandClose, 'close'],
        [command.ApplicationMenuCommandOpenCluster, 'openCluster'],
        [command.ApplicationMenuCommandSettings, 'toggleSettings'],
        [command.ApplicationMenuCommandCommandPalette, 'openCommandPalette'],
        [command.ApplicationMenuCommandZoomIn, 'zoomIn'],
        [command.ApplicationMenuCommandZoomOut, 'zoomOut'],
        [command.ApplicationMenuCommandZoomReset, 'zoomReset'],
        [command.ApplicationMenuCommandToggleSidebar, 'toggleSidebar'],
        [command.ApplicationMenuCommandToggleObjectDiff, 'toggleObjectDiff'],
        [command.ApplicationMenuCommandToggleAppLogs, 'toggleAppLogs'],
        [command.ApplicationMenuCommandToggleDiagnostics, 'toggleDiagnostics'],
        [command.ApplicationMenuCommandOpenInspector, 'openInspector'],
        [command.ApplicationMenuCommandToggleFocusDebug, 'toggleFocusDebug'],
        [command.ApplicationMenuCommandTogglePanelDebug, 'togglePanelDebug'],
        [command.ApplicationMenuCommandToggleMapDebug, 'toggleMapDebug'],
        [command.ApplicationMenuCommandToggleIconDebug, 'toggleIconDebug'],
        [command.ApplicationMenuCommandToggleErrorDebug, 'toggleErrorDebug'],
        [command.ApplicationMenuCommandAbout, 'openAbout'],
      ];

    mappings.forEach(([menuCommand, action]) => {
      expect(dispatchWorkspaceApplicationMenuCommand(menuCommand, actions)).toBe(true);
      expect(actions[action]).toHaveBeenCalledOnce();
    });
  });

  it('leaves process and native-window commands to the backend owner', () => {
    const actions = new Proxy(
      {},
      { get: () => vi.fn() }
    ) as unknown as WorkspaceApplicationMenuActions;

    expect(
      dispatchWorkspaceApplicationMenuCommand(command.ApplicationMenuCommandQuit, actions)
    ).toBe(false);
    expect(
      dispatchWorkspaceApplicationMenuCommand(command.ApplicationMenuCommandMinimise, actions)
    ).toBe(false);
    expect(
      dispatchWorkspaceApplicationMenuCommand(
        command.ApplicationMenuCommandCheckForUpdates,
        actions
      )
    ).toBe(false);
  });

  it('preserves Settings toggle semantics instead of forcing it open', () => {
    let settingsOpen = true;
    const actions = new Proxy(
      {
        toggleSettings: () => {
          settingsOpen = !settingsOpen;
        },
      },
      { get: (target, property) => Reflect.get(target, property) ?? vi.fn() }
    ) as unknown as WorkspaceApplicationMenuActions;

    expect(
      dispatchWorkspaceApplicationMenuCommand(command.ApplicationMenuCommandSettings, actions)
    ).toBe(true);
    expect(settingsOpen).toBe(false);
  });
});
