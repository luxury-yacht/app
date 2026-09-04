import { vi } from 'vitest';

// Import the installed runtime normally; only its native transport and layout
// measurements are supplied by the test environment.
export const installWailsDragRuntime = async (os: 'windows' | 'linux' = 'windows') => {
  vi.resetModules();
  const invoke = vi.fn();
  vi.doMock('../../node_modules/@wailsio/runtime/dist/system.js', () => ({
    invoke,
    IsWindows: () => os === 'windows',
    IsLinux: () => os === 'linux',
    IsMac: () => false,
  }));

  const disposers: Array<() => void> = [];
  const trackListeners = (target: EventTarget) => {
    const add = target.addEventListener.bind(target);
    return vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
      add(type, listener, options);
      disposers.push(() => target.removeEventListener(type, listener, options));
    });
  };
  const windowListeners = trackListeners(window);
  const documentListeners = trackListeners(document);
  const width = vi
    .spyOn(document.documentElement, 'clientWidth', 'get')
    .mockReturnValue(window.innerWidth);
  const height = vi
    .spyOn(document.documentElement, 'clientHeight', 'get')
    .mockReturnValue(window.innerHeight);
  const interval = vi.spyOn(window, 'setInterval');
  const originalRuntime = Object.getOwnPropertyDescriptor(window, '_wails');
  const runtimeState = {
    environment: { OS: os },
    flags: { frameless: true },
    setResizable: (_value: boolean) => undefined,
  };
  Object.defineProperty(window, '_wails', {
    configurable: true,
    writable: true,
    value: runtimeState,
  });

  const cleanup = () => {
    runtimeState.setResizable(false);
    disposers.forEach((dispose) => {
      dispose();
    });
    width.mockRestore();
    height.mockRestore();
    if (originalRuntime) {
      Object.defineProperty(window, '_wails', originalRuntime);
    } else {
      Reflect.deleteProperty(window, '_wails');
    }
    vi.doUnmock('../../node_modules/@wailsio/runtime/dist/system.js');
  };

  try {
    await vi.importActual('../../node_modules/@wailsio/runtime/dist/drag.js');
    runtimeState.setResizable(true);
    return { invoke, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    windowListeners.mockRestore();
    documentListeners.mockRestore();
    for (const result of interval.mock.results) {
      if (result.type === 'return') {
        window.clearInterval(result.value);
      }
    }
    interval.mockRestore();
  }
};
