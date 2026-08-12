/**
 * Mock helper for controlling what Settings-related Go RPCs return in Storybook.
 * Works by setting overrides used by the Storybook Wails v3 transport.
 */

interface SettingsMockOptions {
  /** Light/dark/system mode returned by GetAppSettings(). */
  appearanceMode?: 'light' | 'dark' | 'system';
  /** Value returned by GetKubeconfigSearchPaths(). */
  kubeconfigSearchPaths?: string[];
}

const defaultOptions: Required<SettingsMockOptions> = {
  appearanceMode: 'system',
  kubeconfigSearchPaths: ['~/.kube'],
};

/**
 * Install Go backend overrides for the Settings component.
 * Call this in a story decorator before the component mounts.
 */
export function setMockSettingsBackend(options: SettingsMockOptions = {}): void {
  const merged = { ...defaultOptions, ...options };
  const overrides = window.__storybookBackendOverrides || {};
  window.__storybookBackendOverrides = overrides;

  overrides.GetAppSettings = () =>
    Promise.resolve({
      appearanceMode: merged.appearanceMode,
      useShortResourceNames: false,
      autoRefreshEnabled: false,
      refreshBackgroundClustersEnabled: false,
      metricsRefreshIntervalMs: 30000,
      gridTablePersistenceMode: 'shared',
      defaultObjectPanelPosition: 'right',
    });
  overrides.GetKubeconfigSearchPaths = () => Promise.resolve(merged.kubeconfigSearchPaths);
  // Stub mutating calls so they resolve without errors.
  overrides.SetKubeconfigSearchPaths = () => Promise.resolve();
  overrides.OpenKubeconfigSearchPathDialog = () => Promise.resolve('');
  // Stub kubeconfig list calls used by KubeconfigProvider.
  overrides.GetKubeconfigs = () =>
    Promise.resolve({ kubeconfigs: [], state: 'no_kubeconfigs', searchPaths: ['~/.kube'] });
  overrides.GetSelectedKubeconfigs = () => Promise.resolve([]);
  overrides.SetSelectedKubeconfigs = () => Promise.resolve();
}

// Install defaults immediately so the component works without explicit setup.
setMockSettingsBackend();
