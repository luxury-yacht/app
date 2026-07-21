/**
 * frontend/src/core/contexts/KubernetesProvider.test.tsx
 *
 * Test suite for KubernetesProvider.
 * Guards provider ordering for KubeconfigContext usage.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { KubernetesProvider } from './KubernetesProvider';

const wailsMocks = vi.hoisted(() => ({
  GetKubeconfigs: vi.fn().mockResolvedValue([]),
  GetClusterWorkspaceState: vi.fn().mockResolvedValue({
    selectedKubeconfigs: [],
    visibleClusterId: '',
    clusters: {},
  }),
  SetSidebarVisible: vi.fn(),
  GetCatalogDiagnostics: vi.fn().mockResolvedValue({ enabled: false }),
  GetAppearanceModeInfo: vi.fn().mockResolvedValue({ userMode: 'system' }),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetKubeconfigs: (...args: unknown[]) => wailsMocks.GetKubeconfigs(...args),
  GetClusterWorkspaceState: (...args: unknown[]) => wailsMocks.GetClusterWorkspaceState(...args),
  SetSidebarVisible: (...args: unknown[]) => wailsMocks.SetSidebarVisible(...args),
  GetCatalogDiagnostics: (...args: unknown[]) => wailsMocks.GetCatalogDiagnostics(...args),
  GetAppearanceModeInfo: (...args: unknown[]) => wailsMocks.GetAppearanceModeInfo(...args),
}));

vi.mock('@wailsjs/go/models', () => ({
  types: {},
  backend: {},
}));

const mockMatchMedia = () => ({
  matches: false,
  media: '',
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

describe('KubernetesProvider', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: mockMatchMedia,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders without throwing when composing core providers', async () => {
    await act(async () => {
      root.render(
        <KubernetesProvider>
          <div data-testid="child" />
        </KubernetesProvider>
      );
      await flushAsync();
    });
  });
});
