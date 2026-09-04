import { describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  dispatchPanelApplicationMenuCommand,
  type PanelApplicationMenuActions,
} from './panelApplicationMenuCommands';

const command = backend.ApplicationMenuCommand;

describe('dispatchPanelApplicationMenuCommand', () => {
  it('executes panel-local commands in the child renderer', () => {
    const actions: PanelApplicationMenuActions = {
      close: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
      minimise: vi.fn(),
      maximise: vi.fn(),
      restore: vi.fn(),
      toggleMaximise: vi.fn(),
      openInspector: vi.fn(),
    };
    const mappings: Array<[backend.ApplicationMenuCommand, keyof PanelApplicationMenuActions]> = [
      [command.ApplicationMenuCommandClose, 'close'],
      [command.ApplicationMenuCommandZoomIn, 'zoomIn'],
      [command.ApplicationMenuCommandZoomOut, 'zoomOut'],
      [command.ApplicationMenuCommandZoomReset, 'zoomReset'],
      [command.ApplicationMenuCommandMinimise, 'minimise'],
      [command.ApplicationMenuCommandMaximise, 'maximise'],
      [command.ApplicationMenuCommandRestore, 'restore'],
      [command.ApplicationMenuCommandToggleMaximise, 'toggleMaximise'],
      [command.ApplicationMenuCommandOpenInspector, 'openInspector'],
    ];

    mappings.forEach(([menuCommand, action]) => {
      expect(dispatchPanelApplicationMenuCommand(menuCommand, actions)).toBe(true);
      expect(actions[action]).toHaveBeenCalledOnce();
    });
  });

  it('leaves owner-routed and process commands to the backend', () => {
    const actions = new Proxy({}, { get: () => vi.fn() }) as PanelApplicationMenuActions;

    expect(
      dispatchPanelApplicationMenuCommand(command.ApplicationMenuCommandSettings, actions)
    ).toBe(false);
    expect(dispatchPanelApplicationMenuCommand(command.ApplicationMenuCommandQuit, actions)).toBe(
      false
    );
  });
});
