import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';

// Execute the installed runtime's actual drag handler, with only its native
// transport and layout measurements supplied by the test environment.
export const installWailsDragRuntime = (os: 'windows' | 'linux' = 'windows') => {
  const disposers: Array<() => void> = [];
  const listen =
    (target: EventTarget) =>
    (type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, listener, options);
      disposers.push(() => target.removeEventListener(type, listener, options));
    };
  const runtimeWindow = {
    _wails: { environment: { OS: os }, setResizable: (_value: boolean) => undefined },
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    addEventListener: listen(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    // Handlers initialise immediately on desktop; no fallback polling needed.
    setInterval: () => 0,
  };
  const invoke = vi.fn();
  const runtimeEntry = createRequire(import.meta.url).resolve('@wailsio/runtime');
  const source = readFileSync(join(dirname(runtimeEntry), 'drag.js'), 'utf8').replace(
    /^import .*;$/gm,
    ''
  );
  runInNewContext(source, {
    window: runtimeWindow,
    document: {
      body: document.body,
      documentElement: { clientWidth: window.innerWidth, clientHeight: window.innerHeight },
      addEventListener: listen(document),
    },
    navigator,
    hasDOM: true,
    canTrackButtons: () => true,
    eventTarget: (event: MouseEvent) =>
      event.target instanceof Element ? event.target : document.body,
    IsWindows: () => os === 'windows',
    IsLinux: () => os === 'linux',
    IsMac: () => false,
    GetFlag: (name: string) => name === 'frameless',
    invoke,
  });
  runtimeWindow._wails.setResizable(true);
  return {
    invoke,
    cleanup: () =>
      disposers.forEach((dispose) => {
        dispose();
      }),
  };
};
