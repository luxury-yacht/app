/**
 * Storybook decorator that wraps stories in all providers the Sidebar needs.
 * Uses KubernetesProvider (the real composite provider) with Go backend calls
 * stubbed via window.__storybookGoOverrides.
 */

import React from 'react';
import type { Decorator } from '@storybook/react';
import { KubernetesProvider } from '@core/contexts/KubernetesProvider';

/**
 * Install Go backend overrides for providers used by the Sidebar.
 * The base stubs in preview.ts return async noOps; these provide
 * specific return values so the providers initialise cleanly.
 */
function installSidebarGoOverrides(): void {
  const overrides = ((window as any).__storybookGoOverrides =
    (window as any).__storybookGoOverrides || {});

  overrides['GetKubeconfigs'] = () => Promise.resolve([]);
  overrides['GetSelectedKubeconfigs'] = () => Promise.resolve([]);
  overrides['SetSelectedKubeconfigs'] = () => Promise.resolve();
  overrides['SetSidebarVisible'] = () => Promise.resolve();
  overrides['GetClusterTabOrder'] = () => Promise.resolve([]);
  overrides['SetClusterTabOrder'] = () => Promise.resolve();
  overrides['GetThemeInfo'] = () =>
    Promise.resolve({ currentTheme: 'dark', userTheme: 'system' });
  overrides['GetCatalogDiagnostics'] = () => Promise.resolve({ enabled: false });
}

export const SidebarProvidersDecorator: Decorator = (Story) => {
  installSidebarGoOverrides();
  return (
    <KubernetesProvider>
      <div style={{ height: '100vh', display: 'flex' }}>
        <Story />
      </div>
    </KubernetesProvider>
  );
};
