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
import {
  resetClusterTabOrderCacheForTesting,
  setClusterTabOrder,
} from '@core/persistence/clusterTabOrder';

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
    setSelectedKubeconfigsMock.mockResolvedValue(undefined);
    mocks.backgroundRefreshState.enabled = true;
    resetClusterTabOrderCacheForTesting();
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
      backgroundRefreshEnabled: true,
    });

    unmount();
  });

  it('keeps open cluster IDs in refresh context when background refresh is disabled', async () => {
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
      allConnectedClusterIds: ['alpha:dev', 'beta:prod'],
      backgroundRefreshEnabled: false,
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

  it('dispatches superseding selection updates immediately', async () => {
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
      // Keep the first selection pending so the second request can supersede it.
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

    expect(setSelectedKubeconfigsMock).toHaveBeenCalledTimes(2);
    expect(setSelectedKubeconfigsMock).toHaveBeenNthCalledWith(2, [
      '/kube/alpha:dev',
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);

    await act(async () => {
      await (secondPromise ?? Promise.resolve());
    });

    resolveFirst();

    unmount();
  });

  it('keeps a close request authoritative when cluster initialization is still pending', async () => {
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
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:prod']);

    let resolveSelection!: () => void;
    const pendingSelection = new Promise<void>((resolve) => {
      resolveSelection = resolve;
    });
    setSelectedKubeconfigsMock.mockReturnValueOnce(pendingSelection);

    const { getContext, unmount } = await renderProvider();

    await act(async () => {
      void getContext().setSelectedKubeconfigs([
        '/kube/alpha:dev',
        '/kube/beta:prod',
        '/kube/gamma:staging',
      ]);
      await flushPromises();
    });

    expect(getContext().selectedKubeconfigs).toEqual([
      '/kube/alpha:dev',
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);

    act(() => {
      getContext().setActiveKubeconfig('/kube/alpha:dev');
    });
    expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');

    await act(async () => {
      await getContext().closeKubeconfig('/kube/alpha:dev');
      await flushPromises();
    });

    expect(setSelectedKubeconfigsMock).toHaveBeenLastCalledWith([
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/beta:prod', '/kube/gamma:staging']);
    expect(getContext().selectedKubeconfig).toBe('/kube/beta:prod');

    await act(async () => {
      resolveSelection();
      await pendingSelection;
      await flushPromises();
    });

    expect(getContext().selectedKubeconfigs).toEqual(['/kube/beta:prod', '/kube/gamma:staging']);
    expect(getContext().selectedKubeconfig).toBe('/kube/beta:prod');

    unmount();
  });

  it('activates the right-adjacent cluster when closing the active middle tab', async () => {
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
    getSelectedKubeconfigsMock.mockResolvedValue([
      '/kube/alpha:dev',
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);

    const { getContext, unmount } = await renderProvider();

    act(() => {
      getContext().setActiveKubeconfig('/kube/beta:prod');
    });

    await act(async () => {
      await getContext().closeKubeconfig('/kube/beta:prod');
      await flushPromises();
    });

    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev', '/kube/gamma:staging']);
    expect(getContext().selectedKubeconfig).toBe('/kube/gamma:staging');

    unmount();
  });

  it('uses the same close transition when selection replacement removes the active tab', async () => {
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
    getSelectedKubeconfigsMock.mockResolvedValue([
      '/kube/alpha:dev',
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);

    const { getContext, unmount } = await renderProvider();

    act(() => {
      getContext().setActiveKubeconfig('/kube/beta:prod');
    });

    await act(async () => {
      await getContext().setSelectedKubeconfigs(['/kube/alpha:dev', '/kube/gamma:staging']);
      await flushPromises();
    });

    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev', '/kube/gamma:staging']);
    expect(getContext().selectedKubeconfig).toBe('/kube/gamma:staging');

    unmount();
  });

  it('opens and activates a cluster through the shared selection transition', async () => {
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
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/beta:prod']);

    const { getContext, unmount } = await renderProvider();

    await act(async () => {
      await getContext().openKubeconfig('/kube/alpha:dev');
      await flushPromises();
    });

    expect(setSelectedKubeconfigsMock).toHaveBeenLastCalledWith([
      '/kube/beta:prod',
      '/kube/alpha:dev',
    ]);
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/beta:prod', '/kube/alpha:dev']);
    expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');

    unmount();
  });

  it('uses persisted cluster tab order when activating the next cluster after close', async () => {
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
    getSelectedKubeconfigsMock.mockResolvedValue([
      '/kube/alpha:dev',
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);
    setClusterTabOrder(['/kube/gamma:staging', '/kube/beta:prod', '/kube/alpha:dev']);

    const { getContext, unmount } = await renderProvider();

    act(() => {
      getContext().setActiveKubeconfig('/kube/beta:prod');
    });

    await act(async () => {
      await getContext().closeKubeconfig('/kube/beta:prod');
      await flushPromises();
    });

    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev', '/kube/gamma:staging']);
    expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');

    unmount();
  });

  it('sends the latest remaining cluster set when close requests overlap', async () => {
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
    getSelectedKubeconfigsMock.mockResolvedValue([
      '/kube/alpha:dev',
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);

    let resolveFirstClose!: () => void;
    const firstClose = new Promise<void>((resolve) => {
      resolveFirstClose = resolve;
    });
    setSelectedKubeconfigsMock.mockReturnValueOnce(firstClose).mockResolvedValue(undefined);

    const { getContext, unmount } = await renderProvider();

    await act(async () => {
      void getContext().closeKubeconfig('/kube/beta:prod');
      await flushPromises();
    });

    expect(setSelectedKubeconfigsMock).toHaveBeenNthCalledWith(1, [
      '/kube/alpha:dev',
      '/kube/gamma:staging',
    ]);
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev', '/kube/gamma:staging']);

    await act(async () => {
      await getContext().closeKubeconfig('/kube/gamma:staging');
      await flushPromises();
    });

    expect(setSelectedKubeconfigsMock).toHaveBeenNthCalledWith(2, ['/kube/alpha:dev']);
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev']);
    expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');

    await act(async () => {
      resolveFirstClose();
      await firstClose;
      await flushPromises();
    });

    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev']);
    expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');

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
      backgroundRefreshEnabled: true,
    });

    unmount();
  });
});
