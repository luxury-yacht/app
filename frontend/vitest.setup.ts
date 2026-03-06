import { afterEach, beforeEach, vi } from 'vitest';

const buildStorageShim = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(name: string) {
      return store.has(name) ? store.get(name)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(name: string) {
      store.delete(name);
    },
    setItem(name: string, value: string) {
      store.set(String(name), String(value));
    },
  } satisfies Storage;
};

const ensureStorage = (key: 'localStorage' | 'sessionStorage') => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (descriptor?.get && descriptor.configurable) {
    // Avoid invoking Node's Web Storage getter, which can emit warnings when
    // --localstorage-file is misconfigured in the parent environment.
    Object.defineProperty(globalThis, key, {
      value: buildStorageShim(),
      configurable: true,
      writable: false,
    });
    return;
  }

  const existing = (globalThis as any)[key];
  if (
    existing &&
    typeof existing.setItem === 'function' &&
    typeof existing.removeItem === 'function'
  ) {
    return;
  }

  Object.defineProperty(globalThis, key, {
    value: buildStorageShim(),
    configurable: true,
    writable: false,
  });
};

ensureStorage('localStorage');
ensureStorage('sessionStorage');

// Ensure React testing utilities run without extra warnings
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOnMultiple: () => undefined,
  EventsOff: () => undefined,
  EventsOn: () => undefined,
}));

const originalConsoleError = console.error.bind(console);
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let actWarnings: string[] = [];

beforeEach(() => {
  actWarnings = [];
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = args
      .map((value) => (typeof value === 'string' ? value : String(value)))
      .join(' ');
    if (message.includes('not wrapped in act(')) {
      actWarnings.push(message);
    }
    originalConsoleError(...args);
  });
});

afterEach(() => {
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = null;
  if (actWarnings.length > 0) {
    throw new Error(
      `Detected React act() warning in test:\n${actWarnings.join('\n\n')}\n\nWrap state updates with act(...) or await the associated async UI update.`
    );
  }
});
