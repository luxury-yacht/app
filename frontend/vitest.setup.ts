const ensureStorage = (key: 'localStorage' | 'sessionStorage') => {
  const existing = (globalThis as any)[key];
  if (
    existing &&
    typeof existing.setItem === 'function' &&
    typeof existing.removeItem === 'function'
  ) {
    return;
  }

  const store = new Map<string, string>();

  const storage = {
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

  Object.defineProperty(globalThis, key, {
    value: storage,
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
import { vi } from 'vitest';
