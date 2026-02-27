import { vi } from 'vitest';

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
