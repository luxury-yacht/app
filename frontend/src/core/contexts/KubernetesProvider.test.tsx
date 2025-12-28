/**
 * frontend/src/core/contexts/KubernetesProvider.test.tsx
 *
 * Test suite for KubernetesProvider.
 * Guards provider ordering for KubeconfigContext usage.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { KubernetesProvider } from './KubernetesProvider';

const wailsMocks = vi.hoisted(() => ({
  GetKubeconfigs: vi.fn().mockResolvedValue([]),
  GetSelectedKubeconfigs: vi.fn().mockResolvedValue([]),
  SetSelectedKubeconfigs: vi.fn().mockResolvedValue(undefined),
  SetSidebarVisible: vi.fn(),
  GetCatalogDiagnostics: vi.fn().mockResolvedValue({ enabled: false }),
  GetThemeInfo: vi.fn().mockResolvedValue({ userTheme: 'system' }),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetKubeconfigs: (...args: unknown[]) => wailsMocks.GetKubeconfigs(...args),
  GetSelectedKubeconfigs: (...args: unknown[]) => wailsMocks.GetSelectedKubeconfigs(...args),
  SetSelectedKubeconfigs: (...args: unknown[]) => wailsMocks.SetSelectedKubeconfigs(...args),
  SetSidebarVisible: (...args: unknown[]) => wailsMocks.SetSidebarVisible(...args),
  GetCatalogDiagnostics: (...args: unknown[]) => wailsMocks.GetCatalogDiagnostics(...args),
  GetThemeInfo: (...args: unknown[]) => wailsMocks.GetThemeInfo(...args),
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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
