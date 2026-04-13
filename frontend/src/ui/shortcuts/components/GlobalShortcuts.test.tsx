/**
 * frontend/src/ui/shortcuts/components/GlobalShortcuts.test.tsx
 *
 * Test suite for GlobalShortcuts.
 * Covers key behaviors and edge cases for GlobalShortcuts.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlobalShortcuts } from './GlobalShortcuts';
import { KeyCodes } from '../constants';
import { resetClusterTabOrderCacheForTesting } from '@core/persistence/clusterTabOrder';

// Capture event handlers registered via EventsOn so tests can invoke them.
const wailsEventHandlers: Record<string, (...args: any[]) => void> = {};
const QuitMock = vi.fn();

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOnMultiple: () => undefined,
  EventsOff: (eventName: string) => {
    delete wailsEventHandlers[eventName];
  },
  EventsOn: (eventName: string, handler: (...args: any[]) => void) => {
    wailsEventHandlers[eventName] = handler;
  },
  Quit: (...args: any[]) => QuitMock(...args),
}));

let latestHelpProps: { isOpen: boolean; onClose: () => void } | null = null;
const registeredShortcuts: Array<{
  key: string;
  modifiers?: Record<string, boolean>;
  handler: (event?: KeyboardEvent) => void;
  enabled?: boolean;
}> = [];
const isMacPlatformMock = vi.fn(() => true);
const setSelectedKubeconfigsMock = vi.fn();
const setActiveKubeconfigMock = vi.fn();
const kubeconfigState = {
  selectedKubeconfig: 'cluster-1',
  selectedKubeconfigs: ['cluster-1', 'cluster-2'],
};

vi.mock('../hooks', () => ({
  useShortcut: (options: any) => {
    registeredShortcuts.push({
      key: options.key,
      handler: options.handler,
      modifiers: options.modifiers,
      enabled: options.enabled,
    });
  },
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: () => isMacPlatformMock(),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    kubeconfigs: [],
    selectedKubeconfigs: kubeconfigState.selectedKubeconfigs,
    selectedKubeconfig: kubeconfigState.selectedKubeconfig,
    selectedClusterId: kubeconfigState.selectedKubeconfig,
    selectedClusterName: kubeconfigState.selectedKubeconfig,
    selectedClusterIds: kubeconfigState.selectedKubeconfigs,
    kubeconfigsLoading: false,
    setSelectedKubeconfigs: setSelectedKubeconfigsMock,
    setSelectedKubeconfig: vi.fn(),
    setActiveKubeconfig: setActiveKubeconfigMock,
    getClusterMeta: (selection: string) => ({ id: selection, name: selection }),
    loadKubeconfigs: vi.fn(),
  }),
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({
    zoomLevel: 100,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    canZoomIn: true,
    canZoomOut: true,
  }),
}));

vi.mock('./ShortcutHelpModal', () => ({
  ShortcutHelpModal: (props: { isOpen: boolean; onClose: () => void }) => {
    latestHelpProps = props;
    return (
      <div data-testid="shortcut-help" data-open={props.isOpen}>
        Shortcut Help
      </div>
    );
  },
}));

describe('GlobalShortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof GlobalShortcuts>) => {
    await act(async () => {
      root.render(<GlobalShortcuts {...props} />);
      await Promise.resolve();
    });
  };

  const modifierKeys: Array<'ctrl' | 'meta' | 'shift' | 'alt'> = ['ctrl', 'meta', 'shift', 'alt'];

  const modifiersEqual = (
    actual: Record<string, boolean> | undefined,
    expected: Record<string, boolean>
  ) => {
    return modifierKeys.every((mod) => {
      const actualValue = actual?.[mod] ?? false;
      const expectedValue = expected[mod] ?? false;
      return actualValue === expectedValue;
    });
  };

  const findShortcut = (key: string, modifiers?: Record<string, boolean>) => {
    for (let i = registeredShortcuts.length - 1; i >= 0; i -= 1) {
      if (
        registeredShortcuts[i].key === key &&
        (!modifiers || modifiersEqual(registeredShortcuts[i].modifiers, modifiers))
      ) {
        return registeredShortcuts[i];
      }
    }
    throw new Error(
      `Shortcut for key "${key}"${modifiers ? ` with modifiers ${JSON.stringify(modifiers)}` : ''} not registered`
    );
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    registeredShortcuts.length = 0;
    latestHelpProps = null;
    setSelectedKubeconfigsMock.mockClear();
    setActiveKubeconfigMock.mockClear();
    QuitMock.mockClear();
    // Clear captured Wails event handlers
    for (const key of Object.keys(wailsEventHandlers)) {
      delete wailsEventHandlers[key];
    }
    resetClusterTabOrderCacheForTesting();
    kubeconfigState.selectedKubeconfig = 'cluster-1';
    kubeconfigState.selectedKubeconfigs = ['cluster-1', 'cluster-2'];
    isMacPlatformMock.mockReturnValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('toggles shortcut help overlay through the registered handler', async () => {
    await renderComponent({});

    const helpShortcut = findShortcut('?');
    expect(latestHelpProps?.isOpen).toBe(false);

    act(() => {
      helpShortcut.handler();
    });
    expect(latestHelpProps?.isOpen).toBe(true);

    act(() => {
      helpShortcut.handler();
    });
    expect(latestHelpProps?.isOpen).toBe(false);
  });

  it('prioritises settings modal when Escape shortcut fires', async () => {
    const toggleSettings = vi.fn();
    const toggleLogs = vi.fn();

    await renderComponent({
      onToggleSettings: toggleSettings,
      onToggleLogsPanel: toggleLogs,
      isSettingsOpen: true,
      isLogsPanelOpen: true,
    });

    await act(async () => {
      findShortcut(KeyCodes.ESCAPE).handler();
      await Promise.resolve();
    });

    expect(toggleSettings).toHaveBeenCalledTimes(1);
    expect(toggleLogs).not.toHaveBeenCalled();
  });

  it('closes the help overlay before invoking other Escape handlers', async () => {
    const toggleLogs = vi.fn();

    await renderComponent({
      onToggleLogsPanel: toggleLogs,
      isLogsPanelOpen: true,
    });

    await act(async () => {
      findShortcut('?').handler();
      await Promise.resolve();
    });
    expect(latestHelpProps?.isOpen).toBe(true);

    await act(async () => {
      findShortcut(KeyCodes.ESCAPE).handler();
      await Promise.resolve();
    });

    expect(latestHelpProps?.isOpen).toBe(false);
    expect(toggleLogs).not.toHaveBeenCalled();
  });

  it('falls back to toggling the logs panel when Escape fires', async () => {
    const toggleLogs = vi.fn();

    await renderComponent({
      onToggleLogsPanel: toggleLogs,
      isLogsPanelOpen: true,
      isSettingsOpen: false,
    });

    await act(async () => {
      findShortcut(KeyCodes.ESCAPE).handler();
      await Promise.resolve();
    });

    expect(toggleLogs).toHaveBeenCalledTimes(1);
  });

  it('registers refresh shortcut only when handler provided', async () => {
    isMacPlatformMock.mockReturnValue(true);
    await renderComponent({});
    const refreshShortcutWithoutHandlerMeta = findShortcut('r', { meta: true });
    expect(refreshShortcutWithoutHandlerMeta.enabled).toBe(false);
    expect(() => findShortcut('r', { ctrl: true })).toThrow();

    const refreshHandlerMac = vi.fn();
    await renderComponent({ onRefresh: refreshHandlerMac });
    const refreshShortcutMeta = findShortcut('r', { meta: true });
    expect(refreshShortcutMeta.enabled).toBe(true);

    act(() => {
      refreshShortcutMeta.handler(new KeyboardEvent('keydown'));
    });
    expect(refreshHandlerMac).toHaveBeenCalledTimes(1);

    registeredShortcuts.length = 0;
    isMacPlatformMock.mockReturnValue(false);

    await renderComponent({});
    const refreshShortcutWithoutHandlerCtrl = findShortcut('r', { ctrl: true });
    expect(refreshShortcutWithoutHandlerCtrl.enabled).toBe(false);

    const refreshHandlerCtrl = vi.fn();
    await renderComponent({ onRefresh: refreshHandlerCtrl });
    const refreshShortcutCtrl = findShortcut('r', { ctrl: true });
    expect(refreshShortcutCtrl.enabled).toBe(true);

    act(() => {
      refreshShortcutCtrl.handler(new KeyboardEvent('keydown'));
    });
    expect(refreshHandlerCtrl).toHaveBeenCalledTimes(1);
  });

  it('toggles sidebar when the shortcut fires', async () => {
    const toggleSidebar = vi.fn();
    await renderComponent({ onToggleSidebar: toggleSidebar });

    act(() => {
      findShortcut('b').handler();
    });

    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('toggles logs panel via Ctrl+Shift+L shortcut', async () => {
    const toggleLogs = vi.fn();
    await renderComponent({ onToggleLogsPanel: toggleLogs });

    act(() => {
      findShortcut('l', { ctrl: true, shift: true }).handler();
    });

    expect(toggleLogs).toHaveBeenCalledTimes(1);
  });

  it('toggles diagnostics panel via Ctrl+Shift+D shortcut', async () => {
    const toggleDiagnostics = vi.fn();
    await renderComponent({ onToggleDiagnostics: toggleDiagnostics });

    act(() => {
      findShortcut('d', { ctrl: true, shift: true }).handler();
    });

    expect(toggleDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('does not register an active sessions shortcut', async () => {
    isMacPlatformMock.mockReturnValue(true);
    registeredShortcuts.length = 0;
    await renderComponent({});

    expect(() => findShortcut('s', { meta: true, shift: true })).toThrow('not registered');
  });

  it('toggles object diff viewer via Cmd+D shortcut', async () => {
    const toggleDiff = vi.fn();
    isMacPlatformMock.mockReturnValue(true);
    registeredShortcuts.length = 0;
    await renderComponent({ onToggleObjectDiff: toggleDiff });

    act(() => {
      findShortcut('d', { meta: true }).handler();
    });

    expect(toggleDiff).toHaveBeenCalledTimes(1);
  });

  it('toggles object diff viewer via Ctrl+D shortcut', async () => {
    const toggleDiff = vi.fn();
    isMacPlatformMock.mockReturnValue(false);
    registeredShortcuts.length = 0;
    await renderComponent({ onToggleObjectDiff: toggleDiff });

    act(() => {
      findShortcut('d', { ctrl: true }).handler();
    });

    expect(toggleDiff).toHaveBeenCalledTimes(1);
  });

  it('invokes settings toggle when Cmd+, shortcut fires', async () => {
    const toggleSettings = vi.fn();
    isMacPlatformMock.mockReturnValue(true);
    registeredShortcuts.length = 0;
    await renderComponent({ onToggleSettings: toggleSettings });

    act(() => {
      findShortcut(',', { meta: true }).handler();
    });

    expect(toggleSettings).toHaveBeenCalledTimes(1);
  });

  it('invokes settings toggle when Ctrl+, shortcut fires', async () => {
    const toggleSettings = vi.fn();
    isMacPlatformMock.mockReturnValue(false);
    registeredShortcuts.length = 0;
    await renderComponent({ onToggleSettings: toggleSettings });

    act(() => {
      findShortcut(',', { ctrl: true }).handler();
    });

    expect(toggleSettings).toHaveBeenCalledTimes(1);
  });

  it('closes the active cluster tab on menu:close when multiple tabs open', async () => {
    kubeconfigState.selectedKubeconfig = 'cluster-2';
    kubeconfigState.selectedKubeconfigs = ['cluster-1', 'cluster-2'];

    await renderComponent({});

    expect(wailsEventHandlers['menu:close']).toBeDefined();

    act(() => {
      wailsEventHandlers['menu:close']();
    });

    expect(setSelectedKubeconfigsMock).toHaveBeenCalledWith(['cluster-1']);
    expect(QuitMock).not.toHaveBeenCalled();
  });

  it('quits the application on menu:close when one or no tabs remain', async () => {
    kubeconfigState.selectedKubeconfig = 'cluster-1';
    kubeconfigState.selectedKubeconfigs = ['cluster-1'];

    await renderComponent({});

    expect(wailsEventHandlers['menu:close']).toBeDefined();

    act(() => {
      wailsEventHandlers['menu:close']();
    });

    expect(QuitMock).toHaveBeenCalledTimes(1);
    expect(setSelectedKubeconfigsMock).not.toHaveBeenCalled();
  });

  it('switches to the previous cluster tab on Cmd+Alt+Left', async () => {
    isMacPlatformMock.mockReturnValue(true);
    registeredShortcuts.length = 0;
    kubeconfigState.selectedKubeconfig = 'cluster-2';
    kubeconfigState.selectedKubeconfigs = ['cluster-1', 'cluster-2', 'cluster-3'];

    await renderComponent({});

    act(() => {
      findShortcut(KeyCodes.ARROW_LEFT, { meta: true, alt: true }).handler();
    });

    expect(setActiveKubeconfigMock).toHaveBeenCalledWith('cluster-1');
  });

  it('switches to the next cluster tab on Ctrl+Alt+Right', async () => {
    isMacPlatformMock.mockReturnValue(false);
    registeredShortcuts.length = 0;
    kubeconfigState.selectedKubeconfig = 'cluster-2';
    kubeconfigState.selectedKubeconfigs = ['cluster-1', 'cluster-2', 'cluster-3'];

    await renderComponent({});

    act(() => {
      findShortcut(KeyCodes.ARROW_RIGHT, { ctrl: true, alt: true }).handler();
    });

    expect(setActiveKubeconfigMock).toHaveBeenCalledWith('cluster-3');
  });
});
