import { act, useRef } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { KeyboardProvider, useKeyboardSurface } from '@/ui/shortcuts';
import { ApplicationMenuShortcuts } from './ApplicationMenuShortcuts';

const mocks = vi.hoisted(() => ({
  execute: vi.fn((_command: unknown) => Promise.resolve()),
  isMac: vi.fn(() => false),
}));

vi.mock('@/core/backend-api', () => ({
  ExecuteApplicationMenuCommand: mocks.execute,
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: mocks.isMac,
}));

describe('ApplicationMenuShortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    mocks.execute.mockClear();
    mocks.execute.mockResolvedValue(undefined);
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
          <ApplicationMenuShortcuts enabled={enabled} />
          <SuppressingSurface />
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

  it('routes close and quit through the same typed dispatcher from a suppressing surface', async () => {
    await renderShortcuts();

    press('w');
    press('q');

    expect(mocks.execute.mock.calls).toEqual([
      [backend.ApplicationMenuCommand.ApplicationMenuCommandClose],
      [backend.ApplicationMenuCommand.ApplicationMenuCommandQuit],
    ]);
  });

  it('binds the inspector accelerator advertised by the app menu', async () => {
    await renderShortcuts();

    press('F12', { shiftKey: true });

    expect(mocks.execute).toHaveBeenCalledWith(
      backend.ApplicationMenuCommand.ApplicationMenuCommandOpenInspector
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
});
