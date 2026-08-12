/**
 * frontend/src/core/contexts/KubernetesProvider.test.tsx
 *
 * Test suite for KubernetesProvider.
 * Guards provider ordering for KubeconfigContext usage.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KubernetesProvider } from './KubernetesProvider';

const wailsMocks = vi.hoisted(() => ({
  GetKubeconfigs: vi
    .fn()
    .mockResolvedValue({ kubeconfigs: [], state: 'no_kubeconfigs', searchPaths: ['~/.kube'] }),
  GetClusterWorkspaceState: vi.fn().mockResolvedValue({
    selectedKubeconfigs: [],
    visibleClusterId: '',
    clusters: {},
  }),
  SetSidebarVisible: vi.fn(),
  GetCatalogDiagnostics: vi.fn().mockResolvedValue({ enabled: false }),
  GetAppearanceModeInfo: vi.fn().mockResolvedValue({ userMode: 'system' }),
}));

vi.mock('@core/backend-api', () => ({
  GetKubeconfigs: (...args: unknown[]) => wailsMocks.GetKubeconfigs(...args),
  GetClusterWorkspaceState: (...args: unknown[]) => wailsMocks.GetClusterWorkspaceState(...args),
  SetSidebarVisible: (...args: unknown[]) => wailsMocks.SetSidebarVisible(...args),
  GetCatalogDiagnostics: (...args: unknown[]) => wailsMocks.GetCatalogDiagnostics(...args),
  GetAppearanceModeInfo: (...args: unknown[]) => wailsMocks.GetAppearanceModeInfo(...args),
}));

vi.mock('@core/backend-api/models', () => ({
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

  it('renders its children when composing core providers', async () => {
    await act(async () => {
      root.render(
        <KubernetesProvider>
          <div data-testid="child" />
        </KubernetesProvider>
      );
      await flushAsync();
    });

    // Reaching the child proves every provider in the composition mounted in a
    // workable order: a consumer rendered above its provider throws during
    // render, which leaves the subtree unmounted rather than merely logging.
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });
});
