import { afterEach, vi } from 'vitest';

import { resetResourceInventoryRowCache } from './src/modules/resource-grid/useResourceInventoryTable';

// The resource-inventory revisit replay cache is module-level (it must survive
// unmount). Clear it between specs so one test's rows never replay in another.
afterEach(() => {
  resetResourceInventoryRowCache();
});

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
      return store.get(name) ?? null;
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

  const existing = globalThis[key];
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

vi.mock('@wailsio/runtime', () => {
  const identity = (value: unknown) => value;
  const create = {
    Any: identity,
    Array:
      (convert: (value: unknown) => unknown) =>
      (value: unknown[] | null): unknown[] =>
        value === null ? [] : value.map(convert),
    ByteSlice: (value: unknown) => value ?? '',
    DateFromTime: (value: string) => new Date(value),
    Map:
      (_key: (value: unknown) => unknown, convert: (value: unknown) => unknown) =>
      (value: Record<string, unknown> | null): Record<string, unknown> =>
        Object.fromEntries(
          Object.entries(value ?? {}).map(([key, entry]) => [key, convert(entry)])
        ),
    Nullable:
      (convert: (value: unknown) => unknown) =>
      (value: unknown): unknown =>
        value === null ? null : convert(value),
    Struct:
      (fields: Record<string, (value: unknown) => unknown>) =>
      (value: Record<string, unknown>): Record<string, unknown> => {
        for (const [key, convert] of Object.entries(fields)) {
          if (key in value) {
            value[key] = convert(value[key]);
          }
        }
        return value;
      },
  };
  return {
    Application: { Hide: vi.fn(), Quit: vi.fn(), Show: vi.fn() },
    Browser: { OpenURL: vi.fn() },
    Call: { ByID: vi.fn(), ByName: vi.fn() },
    Clipboard: { SetText: vi.fn(), Text: vi.fn() },
    Create: create,
    Events: { Off: vi.fn(), On: vi.fn(() => () => undefined) },
    JSONStream: (name: string) => {
      const factory = (
        globalThis as typeof globalThis & {
          __wailsJSONStreamFactory?: (streamName: string) => unknown;
        }
      ).__wailsJSONStreamFactory;
      if (!factory) {
        throw new Error(`No JSON stream test factory installed for ${name}`);
      }
      return factory(name);
    },
    objectNames: { Call: 0, Browser: 9 },
    System: { Environment: vi.fn() },
    Flags: { GetFlag: vi.fn(() => undefined) },
    Window: { OpenDevTools: vi.fn(), ToggleMaximise: vi.fn() },
  };
});

// JSDOM emits noisy "navigation to another Document" warnings when tests click
// anchors. The frontend tests assert app-side handlers, not real browser
// navigation, so dispatch the click event without attempting navigation.
Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
  configurable: true,
  writable: true,
  value(this: HTMLAnchorElement) {
    this.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
    );
  },
});

afterEach(async () => {
  const { __resetModalFocusTrapForTest } = await vi.importActual<
    typeof import('./src/shared/components/modals/useModalFocusTrap')
  >('./src/shared/components/modals/useModalFocusTrap');
  __resetModalFocusTrapForTest();
});

// Ensure React testing utilities run without extra warnings
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
