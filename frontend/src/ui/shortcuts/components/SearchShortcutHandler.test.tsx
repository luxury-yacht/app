/** Regression coverage for the built-in search shortcut registered by KeyboardProvider. */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '../context';

const registryMocks = vi.hoisted(() => ({
  focusRegisteredSearchShortcutTarget: vi.fn(),
}));

const isMacPlatformMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('../searchShortcutRegistry', () => ({
  focusRegisteredSearchShortcutTarget: (...args: unknown[]) =>
    registryMocks.focusRegisteredSearchShortcutTarget(...args),
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: () => isMacPlatformMock(),
}));

describe('KeyboardProvider search shortcut', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    registryMocks.focusRegisteredSearchShortcutTarget.mockClear();
    isMacPlatformMock.mockReturnValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderProvider = async () => {
    await act(async () => {
      root.render(<KeyboardProvider>{null}</KeyboardProvider>);
      await Promise.resolve();
    });
  };

  it('registers Cmd or Ctrl+F and focuses the active search target', async () => {
    registryMocks.focusRegisteredSearchShortcutTarget.mockReturnValue(true);
    await renderProvider();

    const metaEvent = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
    document.dispatchEvent(metaEvent);

    expect(metaEvent.defaultPrevented).toBe(true);
    expect(registryMocks.focusRegisteredSearchShortcutTarget).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = ReactDOM.createRoot(container);
    registryMocks.focusRegisteredSearchShortcutTarget.mockClear();
    isMacPlatformMock.mockReturnValue(false);
    await renderProvider();

    const ctrlEvent = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true });
    document.dispatchEvent(ctrlEvent);

    expect(ctrlEvent.defaultPrevented).toBe(true);
    expect(registryMocks.focusRegisteredSearchShortcutTarget).toHaveBeenCalledTimes(1);
  });

  it('allows fallback browser search when the registry has no active target', async () => {
    registryMocks.focusRegisteredSearchShortcutTarget.mockReturnValue(false);
    await renderProvider();

    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(registryMocks.focusRegisteredSearchShortcutTarget).toHaveBeenCalledTimes(1);
  });
});
