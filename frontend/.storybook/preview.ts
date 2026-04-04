import type { Preview } from '@storybook/react';
import '../styles/index.css';

// Stub Wails globals so generated .js files work outside the Wails desktop shell.
// The Wails runtime.js calls window.runtime.*, and App.js calls window.go.backend.App.*.
const noOp = () => {};
const noOpAsync = () => Promise.resolve();

// Proxy that returns noOp for any property access — handles window.runtime.*
// EventsOn/EventsOnMultiple must return a disposer function (not undefined).
const noOpDisposer = () => noOp;

const runtimeProxy = new Proxy(
  {
    BrowserOpenURL: (url: string) => window.open(url, '_blank'),
    EventsOn: noOpDisposer,
    EventsOnMultiple: noOpDisposer,
    EventsOnce: noOpDisposer,
  },
  {
    get(target: Record<string, unknown>, prop: string) {
      return target[prop] ?? noOp;
    },
  },
);

// Overrides for specific Go backend methods. Stories populate this via
// setMockAppInfo() in .storybook/mocks/wailsBackendApp.ts.
// Pre-seed overrides for layout providers that mount immediately.
// Individual stories can add more overrides in their decorators.
(window as any).__storybookGoOverrides = {
  GetKubeconfigs: () => Promise.resolve([]),
  GetSelectedKubeconfigs: () => Promise.resolve([]),
  SetSelectedKubeconfigs: () => Promise.resolve(),
  SetSidebarVisible: () => Promise.resolve(),
  GetClusterTabOrder: () => Promise.resolve([]),
  SetClusterTabOrder: () => Promise.resolve(),
  GetThemeInfo: () => Promise.resolve({ currentTheme: 'dark', userTheme: 'system' }),
  GetCatalogDiagnostics: () => Promise.resolve({ enabled: false }),
  GetAllClusterAuthStates: () => Promise.resolve({}),
  GetAllClusterLifecycleStates: () => Promise.resolve({}),
  RetryClusterAuth: () => Promise.resolve(),
  ListShellSessions: () => Promise.resolve([]),
  ListPortForwards: () => Promise.resolve([]),
  GetAppSettings: () => Promise.resolve({
    theme: 'dark',
    useShortResourceNames: false,
    autoRefreshEnabled: false,
    refreshBackgroundClustersEnabled: false,
    metricsRefreshIntervalMs: 30000,
    gridTablePersistenceMode: 'shared',
    defaultObjectPanelPosition: 'right',
  }),
  GetFavorites: () => Promise.resolve([]),
  AddFavorite: (fav: unknown) => Promise.resolve({ ...(fav as Record<string, unknown>), id: String(Date.now()) }),
  UpdateFavorite: () => Promise.resolve(),
  DeleteFavorite: () => Promise.resolve(),
  SetFavoriteOrder: () => Promise.resolve(),
} as Record<string, (...args: unknown[]) => unknown>;

// Nested proxy for window.go.backend.App.* — returns async noOp for Go RPCs
// unless an override exists.
const goProxy = new Proxy(
  {},
  {
    get() {
      // Returns a proxy for each namespace (e.g. "backend")
      return new Proxy(
        {},
        {
          get() {
            // Returns a proxy for each struct (e.g. "App")
            return new Proxy(
              {},
              {
                get(_target: object, method: string) {
                  const overrides = (window as any).__storybookGoOverrides;
                  if (overrides[method]) {
                    return overrides[method];
                  }
                  return noOpAsync;
                },
              },
            );
          },
        },
      );
    },
  },
);

(window as any).runtime = runtimeProxy;
(window as any).go = goProxy;

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
