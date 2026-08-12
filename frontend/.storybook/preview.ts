import type { Preview } from '@storybook/react';
import { setTransport } from '@wailsio/runtime';
import { createStorybookWailsTransport, type StorybookBackendOverrides } from './wailsTransport';
import '../styles/index.css';

// Overrides for named Wails v3 binding calls. Stories may replace individual methods.
// Pre-seed overrides for layout providers that mount immediately.
// Individual stories can add more overrides in their decorators.
window.__storybookBackendOverrides = {
  GetKubeconfigs: () =>
    Promise.resolve({ kubeconfigs: [], state: 'no_kubeconfigs', searchPaths: ['~/.kube'] }),
  GetSelectedKubeconfigs: () => Promise.resolve([]),
  SetSelectedKubeconfigs: () => Promise.resolve(),
  SetSidebarVisible: () => Promise.resolve(),
  GetClusterTabOrder: () => Promise.resolve([]),
  SetClusterTabOrder: () => Promise.resolve(),
  GetAppearanceModeInfo: () => Promise.resolve({ currentMode: 'dark', userMode: 'system' }),
  GetCatalogDiagnostics: () => Promise.resolve({ enabled: false }),
  GetAllClusterAuthStates: () => Promise.resolve({}),
  GetAllClusterLifecycleStates: () => Promise.resolve({}),
  RetryClusterAuth: () => Promise.resolve(),
  ListShellSessions: () => Promise.resolve([]),
  ListPortForwards: () => Promise.resolve([]),
  GetAppSettings: () =>
    Promise.resolve({
      appearanceMode: 'dark',
      useShortResourceNames: false,
      autoRefreshEnabled: false,
      refreshBackgroundClustersEnabled: false,
      metricsRefreshIntervalMs: 30000,
      gridTablePersistenceMode: 'shared',
      defaultObjectPanelPosition: 'right',
    }),
  GetFavorites: () => Promise.resolve([]),
  AddFavorite: (fav: unknown) =>
    Promise.resolve({ ...(fav as Record<string, unknown>), id: String(Date.now()) }),
  UpdateFavorite: () => Promise.resolve(),
  DeleteFavorite: () => Promise.resolve(),
  SetFavoriteOrder: () => Promise.resolve(),
} satisfies StorybookBackendOverrides;

setTransport(createStorybookWailsTransport(window.__storybookBackendOverrides));
(window as Window & { _wails?: { environment?: unknown } })._wails ||= {};
(window as Window & { _wails: { environment?: unknown } })._wails.environment = {
  Arch: 'browser',
  Debug: true,
  OS: 'browser',
  OSInfo: { Branding: 'Storybook', ID: 'storybook', Name: 'Storybook', Version: '' },
  PlatformInfo: {},
};

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      // Explicit story ordering for the `Shared/Tabs` group. Storybook
      // v7+ serializes this function and re-evaluates it in a sandboxed
      // context where closed-over variables do NOT exist, so the order
      // list must be declared INSIDE the function body — no outer
      // references. Stories whose id isn't in the list fall through to
      // Storybook's default alphabetical sort.
      storySort: (a, b) => {
        const order = [
          'shared-tabs--cluster-tabs',
          'shared-tabs--object-tabs',
          'shared-tabs--object-panel-tabs',
          'shared-tabs--disabled-tabs',
          'shared-tabs--type-safety-demo',
          'shared-tabs--tear-off-seam',
        ];
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if (ai !== -1 && bi !== -1) {
          return ai - bi;
        }
        if (ai !== -1) {
          return -1;
        }
        if (bi !== -1) {
          return 1;
        }
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      },
    },
  },
};

export default preview;
