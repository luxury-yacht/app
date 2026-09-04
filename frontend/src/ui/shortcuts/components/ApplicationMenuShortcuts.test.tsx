import { act, useRef } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { ApplicationMenuCommandProvider } from '@/ui/layout/ApplicationMenuCommandContext';
import { KeyboardProvider, useKeyboardContext, useKeyboardSurface } from '@/ui/shortcuts';
import { ApplicationMenuShortcuts } from './ApplicationMenuShortcuts';

const mocks = vi.hoisted(() => ({
  execute: vi.fn((_command: unknown) => undefined),
  isMac: vi.fn(() => false),
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: mocks.isMac,
  usesCustomWindowFrame: () => !mocks.isMac(),
}));

describe('ApplicationMenuShortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    mocks.execute.mockClear();
    mocks.isMac.mockReturnValue(false);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderShortcuts = async (enabled = true) => {
    const SuppressingSurface = () => {
      const ref = useRef<HTMLButtonElement>(null);
      useKeyboardSurface({
        kind: 'palette',
        rootRef: ref,
        active: true,
        blocking: true,
        suppressShortcuts: true,
      });
      return (
        <button ref={ref} type="button">
          Palette
        </button>
      );
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ApplicationMenuCommandProvider execute={mocks.execute}>
            <ApplicationMenuShortcuts enabled={enabled} />
            <SuppressingSurface />
          </ApplicationMenuCommandProvider>
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    container.querySelector('button')?.focus();
  };

  const press = (key: string, options: KeyboardEventInit = {}) => {
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          ...options,
        })
      );
    });
  };

  it('routes every Windows and Linux accelerator through the shared typed dispatcher', async () => {
    await renderShortcuts();

    const shortcuts: Array<[string, KeyboardEventInit, backend.ApplicationMenuCommand]> = [
      ['n', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandNewWindow],
      ['o', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandOpenCluster],
      ['w', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandClose],
      [',', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandSettings],
      ['q', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandQuit],
      [
        'p',
        { shiftKey: true },
        backend.ApplicationMenuCommand.ApplicationMenuCommandCommandPalette,
      ],
      ['=', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandZoomIn],
      ['-', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandZoomOut],
      ['0', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandZoomReset],
      ['b', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandToggleSidebar],
      ['d', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandToggleObjectDiff],
      ['l', { shiftKey: true }, backend.ApplicationMenuCommand.ApplicationMenuCommandToggleAppLogs],
      [
        'd',
        { shiftKey: true },
        backend.ApplicationMenuCommand.ApplicationMenuCommandToggleDiagnostics,
      ],
      ['m', {}, backend.ApplicationMenuCommand.ApplicationMenuCommandMinimise],
      [
        'F12',
        { shiftKey: true },
        backend.ApplicationMenuCommand.ApplicationMenuCommandOpenInspector,
      ],
    ];
    shortcuts.forEach(([key, options]) => {
      press(key, options);
    });

    expect(mocks.execute.mock.calls.map(([command]) => command)).toEqual(
      shortcuts.map(([, , command]) => command)
    );
  });

  it('does not dispatch before a panel window is ready or for repeated keydown events', async () => {
    await renderShortcuts(false);
    press('w');
    expect(mocks.execute).not.toHaveBeenCalled();

    await renderShortcuts(true);
    press('w', { repeat: true });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('leaves macOS accelerators to the native application menu', async () => {
    mocks.isMac.mockReturnValue(true);
    await renderShortcuts();

    press('w');

    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('keeps native macOS accelerators discoverable in shortcut help', async () => {
    mocks.isMac.mockReturnValue(true);
    let getAvailable: ReturnType<typeof useKeyboardContext>['getAvailableShortcuts'] = () => [];
    const Capture = () => {
      const keyboard = useKeyboardContext();
      getAvailable = keyboard.getAvailableShortcuts;
      return null;
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ApplicationMenuCommandProvider execute={mocks.execute}>
            <ApplicationMenuShortcuts />
            <Capture />
          </ApplicationMenuCommandProvider>
        </KeyboardProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const application = getAvailable().find(({ category }) => category === 'Application');
    expect(application?.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'b', modifiers: expect.objectContaining({ meta: true }) }),
        expect.objectContaining({
          key: 'l',
          modifiers: expect.objectContaining({ ctrl: true, shift: true }),
        }),
        expect.objectContaining({ key: '=', modifiers: expect.objectContaining({ meta: true }) }),
        expect.objectContaining({
          key: 'p',
          modifiers: expect.objectContaining({ meta: true, shift: true }),
        }),
      ])
    );
  });
});
