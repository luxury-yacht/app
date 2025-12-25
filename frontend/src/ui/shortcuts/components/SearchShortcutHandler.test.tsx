/**
 * frontend/src/ui/shortcuts/components/SearchShortcutHandler.test.tsx
 *
 * Test suite for SearchShortcutHandler.
 * Covers key behaviors and edge cases for SearchShortcutHandler.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import SearchShortcutHandler from './SearchShortcutHandler';

const hooksMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  focusRegisteredSearchShortcutTarget: vi.fn(),
}));

const isMacPlatformMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('../hooks', () => ({
  useShortcut: (...args: unknown[]) => hooksMocks.useShortcut(...(args as [])),
}));

vi.mock('../searchShortcutRegistry', () => ({
  focusRegisteredSearchShortcutTarget: (...args: unknown[]) =>
    registryMocks.focusRegisteredSearchShortcutTarget(...args),
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: () => isMacPlatformMock(),
}));

describe('SearchShortcutHandler', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    hooksMocks.useShortcut.mockClear();
    registryMocks.focusRegisteredSearchShortcutTarget.mockClear();
    isMacPlatformMock.mockReturnValue(true);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderHandler = async () => {
    await act(async () => {
      root.render(<SearchShortcutHandler />);
      await Promise.resolve();
    });
  };

  it('registers Cmd or Ctrl+F shortcut that focuses the registered target', async () => {
    registryMocks.focusRegisteredSearchShortcutTarget.mockReturnValue(true);
    await renderHandler();

    expect(hooksMocks.useShortcut).toHaveBeenCalledTimes(1);
    const primaryConfig = hooksMocks.useShortcut.mock.calls[0][0] as {
      handler: () => boolean;
      view: string;
      priority: number;
      modifiers?: { meta?: boolean; ctrl?: boolean };
    };
    expect(primaryConfig.modifiers?.meta).toBe(true);
    expect(primaryConfig.view).toBe('global');
    expect(primaryConfig.priority).toBe(1000);
    const handled = primaryConfig.handler();
    expect(handled).toBe(true);
    expect(registryMocks.focusRegisteredSearchShortcutTarget).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    root = ReactDOM.createRoot(container);
    hooksMocks.useShortcut.mockClear();
    registryMocks.focusRegisteredSearchShortcutTarget.mockClear();
    isMacPlatformMock.mockReturnValue(false);
    await renderHandler();
    expect(hooksMocks.useShortcut).toHaveBeenCalledTimes(1);
    const ctrlConfig = hooksMocks.useShortcut.mock.calls[0][0] as {
      modifiers?: { ctrl?: boolean };
    };
    expect(ctrlConfig.modifiers?.ctrl).toBe(true);
  });

  it('falls back when registry has no active targets', async () => {
    registryMocks.focusRegisteredSearchShortcutTarget.mockReturnValue(false);
    await renderHandler();
    const metaConfig = hooksMocks.useShortcut.mock.calls[0][0] as { handler: () => boolean };
    const result = metaConfig.handler();
    expect(result).toBe(false);
    expect(registryMocks.focusRegisteredSearchShortcutTarget).toHaveBeenCalled();
  });
});
