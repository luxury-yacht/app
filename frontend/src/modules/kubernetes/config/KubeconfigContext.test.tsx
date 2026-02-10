/**
 * frontend/src/modules/kubernetes/config/KubeconfigContext.test.tsx
 *
 * Test suite for KubeconfigContext.
 * Covers key behaviors and edge cases for KubeconfigContext.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KubeconfigProvider, useKubeconfig } from './KubeconfigContext';
import type { types } from '@wailsjs/go/models';
import { eventBus } from '@/core/events';

const { getKubeconfigsMock, getSelectedKubeconfigsMock, setSelectedKubeconfigsMock, mocks } =
  vi.hoisted(() => ({
    getKubeconfigsMock: vi.fn(),
    getSelectedKubeconfigsMock: vi.fn(),
    setSelectedKubeconfigsMock: vi.fn(),
    mocks: {
      refreshOrchestrator: {
        updateContext: vi.fn(),
      },
      backgroundRefreshState: { enabled: true },
    },
  }));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetKubeconfigs: () => getKubeconfigsMock(),
  GetSelectedKubeconfigs: () => getSelectedKubeconfigsMock(),
  SetSelectedKubeconfigs: (configs: string[]) => setSelectedKubeconfigsMock(configs),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mocks.refreshOrchestrator,
  useBackgroundRefresh: () => mocks.backgroundRefreshState,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: { handle: vi.fn() },
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceGC', () => ({
  computeClusterHashes: vi.fn(async () => []),
  runGridTableGC: vi.fn(),
}));

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const renderProvider = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  let context: ReturnType<typeof useKubeconfig> | null = null;

  const HookHost = () => {
    context = useKubeconfig();
    return null;
  };

  await act(async () => {
    root.render(
      <KubeconfigProvider>
        <HookHost />
      </KubeconfigProvider>
    );
    // Allow the async kubeconfig loader to resolve before assertions.
    await flushPromises();
  });

  return {
    getContext() {
      if (!context) {
        throw new Error('Kubeconfig context not set');
      }
      return context;
    },
    unmount() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
};

describe('KubeconfigContext', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.refreshOrchestrator.updateContext.mockReset();
    getKubeconfigsMock.mockReset();
    getSelectedKubeconfigsMock.mockReset();
    setSelectedKubeconfigsMock.mockReset();
    mocks.backgroundRefreshState.enabled = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('syncs refresh context with all selected clusters when background refresh is enabled', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: 'C\\Users\\John\\.kube\\config',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigs);
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:prod']);

    const { unmount } = await renderProvider();

    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith({
      selectedClusterId: 'alpha:dev',
      selectedClusterName: 'dev',
      selectedClusterIds: ['alpha:dev'],
      allConnectedClusterIds: ['alpha:dev', 'beta:prod'],
    });

    unmount();
  });

  it('scopes refresh context to the active cluster when background refresh is disabled', async () => {
    mocks.backgroundRefreshState.enabled = false;
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigs);
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:prod']);

    const { unmount } = await renderProvider();

    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith({
      selectedClusterId: 'alpha:dev',
      selectedClusterName: 'dev',
      selectedClusterIds: ['alpha:dev'],
      allConnectedClusterIds: ['alpha:dev'],
    });

    unmount();
  });

  it('allows same context name from different kubeconfig files', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigs);
    getSelectedKubeconfigsMock.mockResolvedValue([]);
    setSelectedKubeconfigsMock.mockResolvedValue(undefined);

    const { getContext, unmount } = await renderProvider();

    await act(async () => {
      await getContext().setSelectedKubeconfigs(['/kube/alpha:dev', '/kube/beta:dev']);
      await flushPromises();
    });

    // Both should be allowed since they're from different files
    expect(setSelectedKubeconfigsMock).toHaveBeenLastCalledWith([
      '/kube/alpha:dev',
      '/kube/beta:dev',
    ]);
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev', '/kube/beta:dev']);

    unmount();
  });

  it('dedupes exact duplicate selections', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigs);
    getSelectedKubeconfigsMock.mockResolvedValue([]);
    setSelectedKubeconfigsMock.mockResolvedValue(undefined);

    const { getContext, unmount } = await renderProvider();

    await act(async () => {
      await getContext().setSelectedKubeconfigs(['/kube/alpha:dev', '/kube/alpha:dev']);
      await flushPromises();
    });

    // Exact duplicates should be deduped
    expect(setSelectedKubeconfigsMock).toHaveBeenLastCalledWith(['/kube/alpha:dev']);
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev']);

    unmount();
  });

  it('emits selection events only when the selection becomes empty or non-empty', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigs);
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev']);
    setSelectedKubeconfigsMock.mockResolvedValue(undefined);

    const emitSpy = vi.spyOn(eventBus, 'emit');
    const { getContext, unmount } = await renderProvider();

    await act(async () => {
      await getContext().setSelectedKubeconfigs([]);
      await flushPromises();
    });

    expect(emitSpy).toHaveBeenCalledWith('kubeconfig:changing', '');
    expect(emitSpy).not.toHaveBeenCalledWith('kubeconfig:changed', '');

    emitSpy.mockClear();

    await act(async () => {
      await getContext().setSelectedKubeconfigs(['/kube/alpha:dev']);
      await flushPromises();
    });

    expect(emitSpy).toHaveBeenCalledWith('kubeconfig:selection-changed');
    expect(emitSpy).toHaveBeenCalledWith('kubeconfig:changed', '');

    emitSpy.mockRestore();
    unmount();
  });

  it('serializes selection updates to avoid overlapping backend calls', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
      },
      {
        name: 'gamma',
        path: '/kube/gamma',
        context: 'staging',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigs);
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev']);

    let resolveFirst!: () => void;
    const firstCall = new Promise<void>((resolve) => {
      // Keep the first selection pending so the second request queues behind it.
      resolveFirst = resolve;
    });

    setSelectedKubeconfigsMock.mockReturnValueOnce(firstCall).mockResolvedValueOnce(undefined);

    const { getContext, unmount } = await renderProvider();
    let secondPromise: Promise<void> | null = null;

    await act(async () => {
      void getContext().setSelectedKubeconfigs(['/kube/alpha:dev', '/kube/beta:prod']);
      secondPromise = getContext().setSelectedKubeconfigs([
        '/kube/alpha:dev',
        '/kube/beta:prod',
        '/kube/gamma:staging',
      ]);
      await flushPromises();
    });

    expect(setSelectedKubeconfigsMock).toHaveBeenCalledTimes(1);

    resolveFirst();

    await act(async () => {
      await (secondPromise ?? Promise.resolve());
    });

    expect(setSelectedKubeconfigsMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('resolves cluster metadata for Windows kubeconfig selections', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'default',
        path: 'C:\\Users\\John\\.kube\\config',
        context: 'minikube',
        isDefault: true,
        isCurrentContext: true,
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigs);
    getSelectedKubeconfigsMock.mockResolvedValue([
      'C\\\\Users\\\\John\\\\.kube\\\\default:minikube',
    ]);

    const { getContext, unmount } = await renderProvider();

    expect(getContext().selectedClusterId).toBe('default:minikube');
    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith({
      selectedClusterId: 'default:minikube',
      selectedClusterName: 'minikube',
      selectedClusterIds: ['default:minikube'],
      allConnectedClusterIds: ['default:minikube'],
    });

    unmount();
  });
});
