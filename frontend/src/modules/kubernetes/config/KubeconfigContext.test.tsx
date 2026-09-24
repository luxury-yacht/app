/**
 * frontend/src/modules/kubernetes/config/KubeconfigContext.test.tsx
 *
 * Test suite for KubeconfigContext.
 * Covers key behaviors and edge cases for KubeconfigContext.
 */

import type { types } from '@core/backend-api/models';
import {
  resetClusterTabOrderCacheForTesting,
  setClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import { act, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { PanelLifecycleGuardProvider } from '@/core/panel-windows/panelLifecycleGuards';
import { WorkspacePanelLifecycle } from '@/core/panel-windows/WorkspacePanelLifecycle';
import { clusterReadiness } from '@/core/refresh/clusterReadiness';
import { TabDragProvider } from '@/shared/components/tabs/dragCoordinator';
import { requireValue } from '@/test-utils/requireValue';
import { DockablePanelProvider } from '@/ui/dockable/DockablePanelProvider';
import ClusterTabs from '@/ui/layout/ClusterTabs';
import { KubeconfigProvider, useKubeconfig } from './KubeconfigContext';

const {
  getKubeconfigsMock,
  getSelectedKubeconfigsMock,
  setSelectedKubeconfigsMock,
  setVisibleClusterMock,
  errorHandlerHandleMock,
  workspaceState,
  mocks,
} = vi.hoisted(() => ({
  getKubeconfigsMock: vi.fn(),
  getSelectedKubeconfigsMock: vi.fn(),
  setSelectedKubeconfigsMock: vi.fn(),
  setVisibleClusterMock: vi.fn(),
  errorHandlerHandleMock: vi.fn(),
  workspaceState: {
    selections: [] as string[],
    visibleClusterId: '',
    clusters: {} as Record<string, { clusterId: string; lifecycle: string }>,
  },
  mocks: {
    nativeClose: vi.fn(),
    panelIdsForCluster: () => [],
    panelSync: {
      flush: async () => undefined,
      quiesceCluster: async () => () => undefined,
    },
    refreshOrchestrator: {
      updateContext: vi.fn(),
    },
    backgroundRefreshState: { enabled: true },
  },
}));

vi.mock('@/core/panel-windows/index', () => ({
  closeClusterView: (...args: unknown[]) => mocks.nativeClose(...args),
  onWorkspaceCloseRequested: () => () => undefined,
  onApplicationQuitPreflightRequested: () => () => undefined,
  onApplicationQuitPreflightSettled: () => () => undefined,
}));
vi.mock('@/core/panel-windows/WorkspacePanelSync', () => ({
  usePanelWorkspaceSync: () => mocks.panelSync,
}));
vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelState: () => ({ panelIdsForCluster: mocks.panelIdsForCluster }),
}));

vi.mock('@core/backend-api', () => ({
  GetClusterTabOrder: async () => [],
  SetClusterTabOrder: async () => undefined,
  GetKubeconfigs: () => getKubeconfigsMock(),
  GetClusterWorkspaceStateForWindow: async () => {
    workspaceState.selections = [...((await getSelectedKubeconfigsMock()) || [])];
    return {
      selectedKubeconfigs: workspaceState.selections,
      visibleClusterId: workspaceState.visibleClusterId,
      clusters: workspaceState.clusters,
    };
  },
  ApplyClusterWorkspace: async (command: {
    selectedKubeconfigs: string[];
    updateSelectedKubeconfigs: boolean;
    visibleClusterId: string;
  }) => {
    if (command.updateSelectedKubeconfigs) {
      await setSelectedKubeconfigsMock(command.selectedKubeconfigs);
      workspaceState.selections = [...command.selectedKubeconfigs];
    }
    await setVisibleClusterMock(command.visibleClusterId);
    workspaceState.visibleClusterId = command.visibleClusterId;
    return {
      state: {
        selectedKubeconfigs: workspaceState.selections,
        visibleClusterId: workspaceState.visibleClusterId,
        clusters: workspaceState.clusters,
      },
      error: '',
    };
  },
}));

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    viewType: 'overview',
    navigateToGlobal: vi.fn(),
    activateClusterWorkspace: vi.fn(),
  }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mocks.refreshOrchestrator,
  useBackgroundRefresh: () => mocks.backgroundRefreshState,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: { handle: errorHandlerHandleMock },
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceGC', () => ({
  computeClusterHashes: vi.fn(async () => []),
  runGridTableGC: vi.fn(),
}));

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const kubeconfigDiscoveryResult = (kubeconfigs: types.KubeconfigInfo[]) => ({
  kubeconfigs,
  state: kubeconfigs.length > 0 ? 'available' : 'no_kubeconfigs',
  searchPaths: [],
});

const renderProvider = async (children?: ReactNode) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  let context: ReturnType<typeof useKubeconfig> | null = null;

  const HookHost = () => {
    context = useKubeconfig();
    return children ?? null;
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
    container,
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
  const prepareRapidTabs = async (selected = ['alpha'], children?: ReactNode) => {
    getKubeconfigsMock.mockResolvedValue(
      kubeconfigDiscoveryResult(
        ['alpha', 'beta', 'gamma'].map((name) => ({
          name,
          path: `/kube/${name}`,
          context: 'dev',
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        }))
      )
    );
    getSelectedKubeconfigsMock.mockResolvedValue(selected.map((name) => `/kube/${name}:dev`));
    return renderProvider(children);
  };

  it.each(['admitted', 'opening'] as const)(
    'keeps rapid closes removed for %s tabs when native lifecycle guards rerender after foreground changes',
    async (state) => {
      const { getContext, unmount } = await prepareRapidTabs(
        state === 'admitted' ? ['alpha', 'beta', 'gamma'] : ['alpha'],
        <PanelLifecycleGuardProvider>
          <DockablePanelProvider>
            <WorkspacePanelLifecycle />
          </DockablePanelProvider>
        </PanelLifecycleGuardProvider>
      );
      let finishNativeClose!: () => void;
      const nativeResponse = new Promise<void>((resolve) => {
        finishNativeClose = resolve;
      });
      mocks.nativeClose.mockImplementation(async (_window: string, clusterId: string) => {
        const selection = `/kube/${clusterId}`;
        if (!workspaceState.selections.includes(selection)) {
          throw new Error('cluster close source is not live');
        }
        workspaceState.selections = workspaceState.selections.filter(
          (value) => value !== selection
        );
        await nativeResponse;
        return true;
      });
      let closing!: Promise<void>[];
      let settled!: Promise<PromiseSettledResult<void>[]>;
      let admit!: () => void;
      const admission = new Promise<void>((resolve) => {
        admit = resolve;
      });
      let opening: Promise<void>[] = [];
      try {
        if (state === 'opening') {
          setSelectedKubeconfigsMock.mockImplementation(() => admission);
          await act(async () => {
            opening = ['beta', 'gamma'].map((name) =>
              getContext().openKubeconfig(`/kube/${name}:dev`)
            );
          });
        }
        await act(async () => {
          closing = ['alpha', 'beta', 'gamma'].map((name) =>
            getContext().closeKubeconfig(`/kube/${name}:dev`)
          );
          settled = Promise.allSettled(closing);
        });
        expect(getContext().selectedKubeconfigs).toEqual([]);
        await act(async () => {
          admit();
          await Promise.all(opening);
          finishNativeClose();
          await settled;
        });
        expect(getContext().selectedKubeconfigs).toEqual([]);
        expect(getContext().managedKubeconfigs).toEqual([]);
        expect(workspaceState.selections).toEqual([]);
        expect(await settled).toEqual(
          closing.map(() => ({ status: 'fulfilled', value: undefined }))
        );
        expect(mocks.nativeClose).toHaveBeenCalledTimes(3);
      } finally {
        admit();
        finishNativeClose();
        unmount();
      }
    }
  );

  it('preserves tab order while an immediate close awaits a denied native result', async () => {
    setClusterTabOrder(['/kube/gamma:dev', '/kube/alpha:dev', '/kube/beta:dev']);
    const { container, getContext, unmount } = await prepareRapidTabs(
      ['alpha', 'beta', 'gamma'],
      <TabDragProvider>
        <ClusterTabs />
      </TabDragProvider>
    );
    let deny!: () => void;
    getContext().registerClusterClosePreflight(
      () =>
        new Promise<null>((resolve) => {
          deny = () => resolve(null);
        })
    );
    let closing!: Promise<void>;
    await act(async () => {
      requireValue(
        container.querySelector<HTMLButtonElement>('button[aria-label="Close gamma:dev"]'),
        'Close gamma'
      ).click();
      closing = getContext().closeKubeconfig('/kube/gamma:dev');
    });
    expect(container.querySelector('button[aria-label="Close gamma:dev"]')).toBeNull();
    await act(async () => {
      deny();
      await closing;
    });
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Global', 'gamma:dev', 'alpha:dev', 'beta:dev']);
    unmount();
  });

  it.each([{ selected: ['alpha'] }, { selected: ['alpha', 'beta'] }])(
    'removes a closing tab before native acceptance while retaining its managed state ($selected)',
    async ({ selected }) => {
      const { getContext, unmount } = await prepareRapidTabs(selected);
      let deny!: () => void;
      getContext().registerClusterClosePreflight(
        () =>
          new Promise<null>((resolve) => {
            deny = () => resolve(null);
          })
      );
      let closing!: Promise<void>;
      try {
        await act(async () => {
          closing = getContext().closeKubeconfig('/kube/alpha:dev');
        });
        expect(getContext().selectedKubeconfigs).toEqual(
          selected.filter((name) => name !== 'alpha').map((name) => `/kube/${name}:dev`)
        );
        expect(getContext().selectedClusterId).toBe(selected.length > 1 ? 'beta:dev' : '');
        expect(getContext().managedClusterIds).toContain('alpha:dev');
      } finally {
        await act(async () => {
          deny();
          await closing;
        });
        expect(getContext().selectedKubeconfigs).toEqual(
          selected.map((name) => `/kube/${name}:dev`)
        );
        expect(getContext().selectedClusterId).toBe('alpha:dev');
        unmount();
      }
    }
  );

  it('removes a tab immediately even while its open acknowledgement is pending', async () => {
    const { getContext, unmount } = await prepareRapidTabs();
    let acceptOpen!: () => void;
    setSelectedKubeconfigsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acceptOpen = resolve;
        })
    );
    let opening!: Promise<void>;
    let closing!: Promise<void>;
    try {
      await act(async () => {
        opening = getContext().openKubeconfig('/kube/beta:dev');
      });
      await act(async () => {
        closing = getContext().closeKubeconfig('/kube/beta:dev');
      });
      expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev']);
      expect(getContext().selectedClusterId).toBe('alpha:dev');
    } finally {
      await act(async () => {
        acceptOpen();
        await Promise.all([opening, closing]);
      });
      expect(workspaceState.selections).toEqual(['/kube/alpha:dev']);
      unmount();
    }
  });

  it('restores a failed close without overwriting a newer tab switch', async () => {
    const { getContext, unmount } = await prepareRapidTabs(['alpha', 'beta', 'gamma']);
    let rejectClose!: (error: Error) => void;
    getContext().registerClusterClosePreflight(
      () =>
        new Promise((_, reject) => {
          rejectClose = reject;
        })
    );
    let closing!: Promise<void>;
    await act(async () => {
      closing = getContext().closeKubeconfig('/kube/alpha:dev');
      getContext().setActiveKubeconfig('/kube/gamma:dev');
    });
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/beta:dev', '/kube/gamma:dev']);
    await act(async () => {
      const failed = expect(closing).rejects.toThrow('close failed');
      rejectClose(new Error('close failed'));
      await failed;
    });
    expect(getContext().selectedKubeconfigs).toEqual([
      '/kube/alpha:dev',
      '/kube/beta:dev',
      '/kube/gamma:dev',
    ]);
    expect(getContext().selectedKubeconfig).toBe('/kube/gamma:dev');
    expect(workspaceState.selections).toEqual(getContext().selectedKubeconfigs);
    unmount();
  });

  it('preserves a newer tab switch when an earlier open finishes', async () => {
    const { getContext, unmount } = await prepareRapidTabs();
    let finishOpen!: () => void;
    setSelectedKubeconfigsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        })
    );
    let opening!: Promise<void>;
    try {
      await act(async () => {
        opening = getContext().openKubeconfig('/kube/beta:dev');
      });
      await act(async () => {
        getContext().setActiveKubeconfig('/kube/alpha:dev');
      });
      expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');
      await act(async () => {
        finishOpen();
        await opening;
      });
      expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');
      expect(workspaceState.visibleClusterId).toBe('alpha:dev');
    } finally {
      unmount();
    }
  });

  it('honors a reopen requested while the same cluster close is awaiting acceptance', async () => {
    const { getContext, unmount } = await prepareRapidTabs(['alpha', 'beta']);
    let acceptClose!: () => void;
    const release = vi.fn();
    getContext().registerClusterClosePreflight(
      () =>
        new Promise((resolve) => {
          acceptClose = () => resolve({ release });
        })
    );
    let closing!: Promise<void>;
    let reopening!: Promise<void>;
    try {
      await act(async () => {
        closing = getContext().closeKubeconfig('/kube/alpha:dev');
      });
      await act(async () => {
        reopening = getContext().openKubeconfig('/kube/alpha:dev');
      });
      await act(async () => {
        acceptClose();
        await Promise.all([closing, reopening]);
      });
      expect(getContext().selectedKubeconfigs).toEqual(['/kube/beta:dev', '/kube/alpha:dev']);
      expect(workspaceState.selections).toEqual(getContext().selectedKubeconfigs);
      expect(getContext().selectedKubeconfig).toBe('/kube/alpha:dev');
      expect(release).toHaveBeenCalledOnce();
    } finally {
      unmount();
    }
  });

  it('keeps backend membership aligned after overlapping opens settle', async () => {
    const { getContext, unmount } = await prepareRapidTabs();
    let finishFirst!: () => void;
    setSelectedKubeconfigsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    );
    let first!: Promise<void>;
    let second!: Promise<void>;
    try {
      await act(async () => {
        first = getContext().openKubeconfig('/kube/beta:dev');
        second = getContext().openKubeconfig('/kube/gamma:dev');
      });
      await act(async () => {
        finishFirst();
        await Promise.all([first, second]);
      });
      expect(getContext().selectedKubeconfigs).toEqual([
        '/kube/alpha:dev',
        '/kube/beta:dev',
        '/kube/gamma:dev',
      ]);
      expect(workspaceState.selections).toEqual(getContext().selectedKubeconfigs);
      expect(workspaceState.visibleClusterId).toBe('gamma:dev');
    } finally {
      unmount();
    }
  });

  it.each(['close', 'replace'] as const)(
    'honors the final %s when a reopen was queued behind the first close',
    async (lastAction) => {
      const { getContext, unmount } = await prepareRapidTabs(['alpha', 'beta']);
      let acceptClose!: () => void;
      const preflight = vi.fn(
        () =>
          new Promise<{ release: () => void }>((resolve) => {
            acceptClose = () => resolve({ release: vi.fn() });
          })
      );
      getContext().registerClusterClosePreflight(preflight);
      try {
        await act(async () => {
          const closing = getContext().closeKubeconfig('/kube/alpha:dev');
          const reopening = getContext().openKubeconfig('/kube/alpha:dev');
          const finalClose =
            lastAction === 'close'
              ? getContext().closeKubeconfig('/kube/alpha:dev')
              : getContext().setSelectedKubeconfigs(['/kube/beta:dev']);
          acceptClose();
          await Promise.all([closing, reopening, finalClose]);
        });
        expect(getContext().selectedKubeconfigs).toEqual(['/kube/beta:dev']);
        expect(workspaceState.selections).toEqual(['/kube/beta:dev']);
        expect(preflight).toHaveBeenCalledOnce();
      } finally {
        unmount();
      }
    }
  );

  it('holds only the closing cluster requests before native teardown and resumes a denied close', async () => {
    const { getContext, unmount } = await prepareRapidTabs(['alpha', 'beta']);
    workspaceState.clusters = {
      'alpha:dev': { clusterId: 'alpha:dev', lifecycle: 'ready' },
      'beta:dev': { clusterId: 'beta:dev', lifecycle: 'ready' },
    };
    eventBus.emit('cluster:lifecycle', { clusterId: 'alpha:dev', state: 'ready' });
    eventBus.emit('cluster:lifecycle', { clusterId: 'beta:dev', state: 'ready' });
    let serviceableDuringClose = true;
    getContext().registerClusterClosePreflight(async () => {
      serviceableDuringClose = clusterReadiness.isServiceable('alpha:dev');
      expect(clusterReadiness.isServiceable('beta:dev')).toBe(true);
      return null;
    });
    try {
      await act(async () => {
        await getContext().closeKubeconfig('/kube/alpha:dev');
        await flushPromises();
      });
      expect(serviceableDuringClose).toBe(false);
      expect(clusterReadiness.isServiceable('alpha:dev')).toBe(true);
      expect(getContext().selectedKubeconfigs).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  it('keeps readiness received while an open acknowledgement is in flight', async () => {
    const { getContext, unmount } = await prepareRapidTabs();
    let finishOpen!: () => void;
    setSelectedKubeconfigsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        })
    );
    let opening!: Promise<void>;
    try {
      await act(async () => {
        opening = getContext().openKubeconfig('/kube/beta:dev');
      });
      eventBus.emit('cluster:lifecycle', { clusterId: 'beta:dev', state: 'ready' });
      await act(async () => {
        finishOpen();
        await opening;
      });
      expect(clusterReadiness.isServiceable('beta:dev')).toBe(true);
    } finally {
      unmount();
    }
  });

  it('clears foreground demand after closing all tabs while an earlier switch is in flight', async () => {
    const { getContext, unmount } = await prepareRapidTabs(['alpha', 'beta']);
    let finishSwitch!: () => void;
    setVisibleClusterMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        })
    );
    try {
      await act(async () => {
        getContext().setActiveKubeconfig('/kube/beta:dev');
      });
      await act(async () => {
        await getContext().setSelectedKubeconfigs([]);
      });
      await act(async () => {
        finishSwitch();
        await flushPromises();
      });
      expect(getContext().selectedKubeconfigs).toEqual([]);
      expect(workspaceState.selections).toEqual([]);
      expect(workspaceState.visibleClusterId).toBe('');
    } finally {
      unmount();
    }
  });

  it('preserves a tab switch made after a reopen that is waiting for close acceptance', async () => {
    const { getContext, unmount } = await prepareRapidTabs(['alpha', 'beta']);
    let acceptClose!: () => void;
    getContext().registerClusterClosePreflight(
      () =>
        new Promise((resolve) => {
          acceptClose = () => resolve({ release: vi.fn() });
        })
    );
    let closing!: Promise<void>;
    let reopening!: Promise<void>;
    try {
      await act(async () => {
        closing = getContext().closeKubeconfig('/kube/alpha:dev');
        reopening = getContext().openKubeconfig('/kube/alpha:dev');
        getContext().setActiveKubeconfig('/kube/beta:dev');
      });
      await act(async () => {
        acceptClose();
        await Promise.all([closing, reopening]);
      });
      expect(getContext().selectedKubeconfig).toBe('/kube/beta:dev');
      expect(workspaceState.visibleClusterId).toBe('beta:dev');
      expect(workspaceState.selections).toEqual(['/kube/beta:dev', '/kube/alpha:dev']);
    } finally {
      unmount();
    }
  });

  it('converges renderer and backend ownership through repeated overlapping tab bursts', async () => {
    const { getContext, unmount } = await prepareRapidTabs(
      ['alpha'],
      <PanelLifecycleGuardProvider>
        <DockablePanelProvider>
          <WorkspacePanelLifecycle />
        </DockablePanelProvider>
      </PanelLifecycleGuardProvider>
    );
    setSelectedKubeconfigsMock.mockImplementation(flushPromises);
    mocks.nativeClose.mockImplementation(async (_window: string, clusterId: string) => {
      const selection = `/kube/${clusterId}`;
      if (!workspaceState.selections.includes(selection)) {
        throw new Error('cluster close source is not live');
      }
      workspaceState.selections = workspaceState.selections.filter((value) => value !== selection);
      await flushPromises();
      return true;
    });
    try {
      for (let iteration = 0; iteration < 25; iteration++) {
        await act(async () => {
          const opening = getContext().openKubeconfig('/kube/beta:dev');
          const sibling = getContext().openKubeconfig('/kube/gamma:dev');
          const closing = getContext().closeKubeconfig('/kube/beta:dev');
          const reopening = getContext().openKubeconfig('/kube/beta:dev');
          getContext().setActiveKubeconfig('/kube/alpha:dev');
          await Promise.all([opening, sibling, closing, reopening]);
        });
        expect(getContext().selectedKubeconfigs).toEqual([
          '/kube/alpha:dev',
          '/kube/gamma:dev',
          '/kube/beta:dev',
        ]);
        expect(workspaceState.selections).toEqual(getContext().selectedKubeconfigs);
        expect(workspaceState.visibleClusterId).toBe('alpha:dev');
        await act(async () => {
          await Promise.all([
            getContext().closeKubeconfig('/kube/beta:dev'),
            getContext().closeKubeconfig('/kube/gamma:dev'),
          ]);
        });
        expect(workspaceState.selections).toEqual(['/kube/alpha:dev']);
        expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev']);
      }
      expect(errorHandlerHandleMock).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('keeps a denied tab open and removes an accepted tab before the follow-up selection RPC settles', async () => {
    getKubeconfigsMock.mockResolvedValue(
      kubeconfigDiscoveryResult(
        ['alpha', 'beta'].map((name) => ({
          name,
          path: `/kube/${name}`,
          context: name,
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        }))
      )
    );
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:alpha', '/kube/beta:beta']);
    const { container, getContext, unmount } = await renderProvider(
      <TabDragProvider>
        <ClusterTabs />
      </TabDragProvider>
    );
    const release = vi.fn();
    const preflight = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ release });
    getContext().registerClusterClosePreflight(preflight);
    const closeAlpha = () =>
      requireValue(
        container.querySelector<HTMLButtonElement>('button[aria-label="Close alpha"]'),
        'Alpha close button'
      ).click();
    await act(async () => closeAlpha());
    expect(container.querySelector('button[aria-label="Close alpha"]')).not.toBeNull();
    expect(setSelectedKubeconfigsMock).not.toHaveBeenCalled();

    let finishSelection: () => void = () => undefined;
    setSelectedKubeconfigsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSelection = resolve;
        })
    );
    try {
      await act(async () => closeAlpha());
      expect(preflight).toHaveBeenLastCalledWith('alpha:alpha', expect.any(Promise));
      expect(container.querySelector('button[aria-label="Close alpha"]')).toBeNull();
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
        'beta'
      );
      expect(getContext().selectedKubeconfigs).toEqual(['/kube/beta:beta']);
      expect(release).not.toHaveBeenCalled();
    } finally {
      await act(async () => finishSelection());
      unmount();
    }
    expect(release).toHaveBeenCalledOnce();
  });

  it('deduplicates a pending close by cluster identity and ignores stale close targets', async () => {
    getKubeconfigsMock.mockResolvedValue(
      kubeconfigDiscoveryResult([
        {
          name: 'alpha',
          path: '/kube/alpha',
          context: 'dev',
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        },
      ])
    );
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev']);
    const { getContext, unmount } = await renderProvider();
    const deny: (() => void)[] = [];
    const preflight = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          deny.push(() => resolve(null));
        })
    );
    const unregister = getContext().registerClusterClosePreflight(preflight);
    let first: Promise<void>, second: Promise<void>;
    act(() => {
      first = getContext().closeKubeconfig('/kube/alpha:dev');
      second = getContext().closeKubeconfig('alpha:dev');
    });
    const calls = preflight.mock.calls.length;
    await act(async () => {
      deny.forEach((resolve) => {
        resolve();
      });
      await Promise.all([first, second]);
    });
    unregister();
    const stale = vi.fn(async () => null);
    getContext().registerClusterClosePreflight(stale);
    await act(async () => getContext().closeKubeconfig('not-open'));
    const staleCalls = stale.mock.calls.length;
    unmount();
    expect(calls).toBe(1);
    expect(staleCalls).toBe(0);
  });

  it('retains an acquired close guard through the selection update', async () => {
    getKubeconfigsMock.mockResolvedValue(
      kubeconfigDiscoveryResult([
        {
          name: 'alpha',
          path: '/kube/alpha',
          context: 'dev',
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        },
      ])
    );
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev']);
    const { getContext, unmount } = await renderProvider();
    const release = vi.fn();
    getContext().registerClusterClosePreflight(async () => ({ release }));
    let complete: () => void = () => undefined;
    setSelectedKubeconfigsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    let closing: Promise<void>;
    await act(async () => {
      closing = getContext().closeKubeconfig('alpha:dev');
    });
    expect(release).not.toHaveBeenCalled();
    await act(async () => {
      complete();
      await closing;
    });
    unmount();
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps a backend-committed close removed when the follow-up selection call fails', async () => {
    getKubeconfigsMock.mockResolvedValue(
      kubeconfigDiscoveryResult([
        {
          name: 'alpha',
          path: '/kube/alpha',
          context: 'dev',
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        },
        {
          name: 'beta',
          path: '/kube/beta',
          context: 'prod',
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        },
      ])
    );
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:prod']);
    const { getContext, unmount } = await renderProvider();
    const release = vi.fn();
    getContext().registerClusterClosePreflight(async () => ({ release }));
    setSelectedKubeconfigsMock.mockRejectedValueOnce(new Error('follow-up RPC unavailable'));
    await act(async () => {
      await expect(getContext().closeKubeconfig('alpha:dev')).rejects.toThrow(
        'follow-up RPC unavailable'
      );
    });
    const selected = getContext().selectedClusterIds;
    const configs = getContext().selectedKubeconfigs;
    unmount();
    expect(selected).toEqual(['beta:prod']);
    expect(configs).toEqual(['/kube/beta:prod']);
    expect(release).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    mocks.nativeClose.mockReset();
    mocks.refreshOrchestrator.updateContext.mockReset();
    getKubeconfigsMock.mockReset();
    getSelectedKubeconfigsMock.mockReset();
    setSelectedKubeconfigsMock.mockReset();
    setSelectedKubeconfigsMock.mockResolvedValue(undefined);
    setVisibleClusterMock.mockReset();
    setVisibleClusterMock.mockResolvedValue(undefined);
    errorHandlerHandleMock.mockReset();
    workspaceState.selections = [];
    workspaceState.visibleClusterId = '';
    workspaceState.clusters = {};
    mocks.backgroundRefreshState.enabled = true;
    clusterReadiness.resetForTests();
    resetClusterTabOrderCacheForTesting();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('preserves the active local cluster when refreshing the shared workspace after a transfer', async () => {
    const configs: types.KubeconfigInfo[] = ['alpha', 'beta'].map((name) => ({
      name,
      path: `/kube/${name}`,
      context: 'dev',
      isDefault: false,
      isCurrentContext: false,
      invalid: false,
      invalidReason: '',
    }));
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(configs));
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:dev']);
    const { getContext, unmount } = await renderProvider();
    await act(async () => {
      getContext().setActiveKubeconfig('/kube/beta:dev');
      await flushPromises();
    });
    await act(async () => {
      await getContext().loadKubeconfigs(true);
    });
    expect(getContext().selectedKubeconfig).toBe('/kube/beta:dev');
    unmount();
  });

  it('reports the initial cluster selection as loading before hydration settles', async () => {
    let resolveKubeconfigs: (result: ReturnType<typeof kubeconfigDiscoveryResult>) => void = () =>
      undefined;
    let resolveSelectedKubeconfigs: (selections: string[]) => void = () => undefined;
    getKubeconfigsMock.mockReturnValue(
      new Promise<ReturnType<typeof kubeconfigDiscoveryResult>>((resolve) => {
        resolveKubeconfigs = resolve;
      })
    );
    getSelectedKubeconfigsMock.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveSelectedKubeconfigs = resolve;
      })
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const observedLoadingStates: boolean[] = [];

    const LoadingStateObserver = () => {
      observedLoadingStates.push(useKubeconfig().kubeconfigsLoading);
      return null;
    };

    await act(async () => {
      root.render(
        <KubeconfigProvider>
          <LoadingStateObserver />
        </KubeconfigProvider>
      );
      await Promise.resolve();
    });
    const initialLoadingState = observedLoadingStates[0];

    await act(async () => {
      resolveKubeconfigs(kubeconfigDiscoveryResult([]));
      resolveSelectedKubeconfigs([]);
      await flushPromises();
    });
    act(() => {
      root.unmount();
      container.remove();
    });

    expect(initialLoadingState).toBe(true);
  });

  it('publishes discovered kubeconfigs while initial foreground activation is pending', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev']);
    let resolveActivation!: () => void;
    setVisibleClusterMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveActivation = resolve;
      })
    );

    const { getContext, unmount } = await renderProvider();

    expect(setVisibleClusterMock).toHaveBeenCalledWith('alpha:dev');
    expect(getContext().kubeconfigs).toEqual(kubeconfigs);
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev']);
    expect(getContext().selectedClusterId).toBe('alpha:dev');
    expect(getContext().kubeconfigsLoading).toBe(false);

    await act(async () => {
      resolveActivation();
      await flushPromises();
    });
    unmount();
  });

  it('exposes missing search paths as a non-error discovery state', async () => {
    getKubeconfigsMock.mockResolvedValue({
      kubeconfigs: [],
      state: 'search_paths_missing',
      searchPaths: ['~/.kube'],
    });
    getSelectedKubeconfigsMock.mockResolvedValue([]);

    const { getContext, unmount } = await renderProvider();

    expect(getContext().kubeconfigDiscoveryState).toBe('search_paths_missing');
    expect(getContext().kubeconfigSearchPaths).toEqual(['~/.kube']);
    expect(errorHandlerHandleMock).not.toHaveBeenCalled();

    unmount();
  });

  it('exposes an empty kubeconfig scan without reporting an application error', async () => {
    getKubeconfigsMock.mockResolvedValue({
      kubeconfigs: [],
      state: 'no_kubeconfigs',
      searchPaths: ['~/.kube', '/etc/kubernetes'],
    });
    getSelectedKubeconfigsMock.mockResolvedValue([]);

    const { getContext, unmount } = await renderProvider();

    expect(getContext().kubeconfigDiscoveryState).toBe('no_kubeconfigs');
    expect(getContext().kubeconfigSearchPaths).toEqual(['~/.kube', '/etc/kubernetes']);
    expect(errorHandlerHandleMock).not.toHaveBeenCalled();

    unmount();
  });

  it('syncs refresh context with all selected clusters when background refresh is enabled', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: 'C\\Users\\John\\.kube\\config',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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

  it('updates cluster-data identity after activating an already committed tab', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:prod']);

    const { getContext, unmount } = await renderProvider();

    act(() => {
      getContext().setActiveKubeconfig('/kube/beta:prod');
    });

    await act(async () => {
      await flushPromises();
    });

    expect(getContext().selectedKubeconfig).toBe('/kube/beta:prod');
    expect(getContext().selectedClusterId).toBe('beta:prod');
    expect(getContext().selectedClusterIds).toEqual(['alpha:dev', 'beta:prod']);

    unmount();
  });

  it('publishes a switched tab to data consumers while backend foreground activation is pending', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:prod']);

    const { getContext, unmount } = await renderProvider();
    mocks.refreshOrchestrator.updateContext.mockClear();
    setVisibleClusterMock.mockClear();
    let resolveActivation!: () => void;
    setVisibleClusterMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveActivation = resolve;
      })
    );
    workspaceState.clusters['beta:prod'] = { clusterId: 'beta:prod', lifecycle: 'ready' };
    eventBus.emit('cluster:lifecycle', { clusterId: 'beta:prod', state: 'ready' });
    expect(clusterReadiness.isServiceable('beta:prod')).toBe(true);

    act(() => {
      getContext().setActiveKubeconfig('/kube/beta:prod');
    });
    await act(async () => {
      await flushPromises();
    });

    expect(setVisibleClusterMock).toHaveBeenCalledWith('beta:prod');
    expect(clusterReadiness.isServiceable('beta:prod')).toBe(false);
    expect(getContext().selectedKubeconfig).toBe('/kube/beta:prod');
    expect(getContext().selectedClusterId).toBe('beta:prod');
    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedClusterId: 'beta:prod',
        selectedClusterIds: ['beta:prod'],
        allConnectedClusterIds: ['alpha:dev', 'beta:prod'],
      })
    );

    await act(async () => {
      resolveActivation();
      await flushPromises();
    });

    expect(clusterReadiness.isServiceable('beta:prod')).toBe(true);
    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedClusterId: 'beta:prod',
        selectedClusterIds: ['beta:prod'],
        allConnectedClusterIds: ['alpha:dev', 'beta:prod'],
      })
    );

    unmount();
  });

  it('keeps showing retained tab data when backend foreground activation fails', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev', '/kube/beta:prod']);

    const { getContext, unmount } = await renderProvider();
    mocks.refreshOrchestrator.updateContext.mockClear();
    setVisibleClusterMock.mockRejectedValueOnce(new Error('binding unavailable'));
    eventBus.emit('cluster:lifecycle', { clusterId: 'beta:prod', state: 'ready' });

    act(() => {
      getContext().setActiveKubeconfig('/kube/beta:prod');
    });
    await act(async () => {
      await flushPromises();
    });

    expect(getContext().selectedKubeconfig).toBe('/kube/beta:prod');
    expect(getContext().selectedClusterId).toBe('beta:prod');
    expect(clusterReadiness.isServiceable('beta:prod')).toBe(true);
    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedClusterId: 'beta:prod',
        selectedClusterIds: ['beta:prod'],
      })
    );

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
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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

  it('serializes backend membership writes while presenting the latest tab intent immediately', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'gamma',
        path: '/kube/gamma',
        context: 'staging',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev']);

    let resolveFirst!: () => void;
    const firstCall = new Promise<void>((resolve) => {
      // Hold admission of the first tab set while the user opens another tab.
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
    expect(getContext().selectedKubeconfigs).toEqual([
      '/kube/alpha:dev',
      '/kube/beta:prod',
      '/kube/gamma:staging',
    ]);
    await act(async () => {
      resolveFirst();
      await secondPromise;
    });
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

  it('exposes the pending active tab identity while keeping refresh context committed', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
    getSelectedKubeconfigsMock.mockResolvedValue(['/kube/alpha:dev']);

    let resolveSelection!: () => void;
    const pendingSelection = new Promise<void>((resolve) => {
      resolveSelection = resolve;
    });
    setSelectedKubeconfigsMock.mockReturnValueOnce(pendingSelection);

    const { getContext, unmount } = await renderProvider();
    let openPromise: Promise<void> | null = null;

    await act(async () => {
      openPromise = getContext().openKubeconfig('/kube/beta:prod');
      await flushPromises();
    });

    expect(getContext().selectedKubeconfig).toBe('/kube/beta:prod');
    expect(getContext().selectedKubeconfigs).toEqual(['/kube/alpha:dev', '/kube/beta:prod']);
    expect(getContext().selectedClusterId).toBe('beta:prod');
    expect(getContext().selectedClusterIds).toEqual(['alpha:dev', 'beta:prod']);
    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith({
      selectedClusterId: 'alpha:dev',
      selectedClusterName: 'dev',
      selectedClusterIds: ['alpha:dev'],
      allConnectedClusterIds: ['alpha:dev'],
      backgroundRefreshEnabled: true,
    });

    await act(async () => {
      resolveSelection();
      await (openPromise ?? Promise.resolve());
      await flushPromises();
    });

    expect(getContext().selectedClusterId).toBe('beta:prod');
    expect(getContext().selectedClusterIds).toEqual(['alpha:dev', 'beta:prod']);
    expect(mocks.refreshOrchestrator.updateContext).toHaveBeenLastCalledWith({
      selectedClusterId: 'beta:prod',
      selectedClusterName: 'prod',
      selectedClusterIds: ['beta:prod'],
      allConnectedClusterIds: ['alpha:dev', 'beta:prod'],
      backgroundRefreshEnabled: true,
    });

    unmount();
  });

  it('waits for tab admission before closing and preserves the close through pending lifecycle work', async () => {
    const kubeconfigs: types.KubeconfigInfo[] = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'gamma',
        path: '/kube/gamma',
        context: 'staging',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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

    let closing!: Promise<void>;
    await act(async () => {
      closing = getContext().closeKubeconfig('/kube/alpha:dev');
    });
    expect(setSelectedKubeconfigsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSelection();
      await closing;
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
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'gamma',
        path: '/kube/gamma',
        context: 'staging',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'gamma',
        path: '/kube/gamma',
        context: 'staging',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'gamma',
        path: '/kube/gamma',
        context: 'staging',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'gamma',
        path: '/kube/gamma',
        context: 'staging',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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

    let secondClose!: Promise<void>;
    await act(async () => {
      secondClose = getContext().closeKubeconfig('/kube/gamma:staging');
    });
    await act(async () => {
      resolveFirstClose();
      await secondClose;
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
        invalid: false,
        invalidReason: '',
      },
    ];
    getKubeconfigsMock.mockResolvedValue(kubeconfigDiscoveryResult(kubeconfigs));
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
