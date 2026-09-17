/**
 * frontend/src/modules/kubernetes/config/KubeconfigContext.tsx
 *
 * Context and provider for KubeconfigContext.
 * Defines shared state and accessors for the kubernetes feature.
 */

import type { types } from '@core/backend-api/models';
import { onEvent } from '@core/desktop-runtime';
import {
  computeClusterHashes,
  runGridTableGC,
} from '@shared/components/tables/persistence/gridTablePersistenceGC';
import { errorHandler } from '@utils/errorHandler';
import type React from 'react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { readKubeconfigs, requestAppState } from '@/core/app-state-access';
import { ApplyClusterWorkspace } from '@/core/backend-api';
import { clusterWorkspaceStore } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { eventBus } from '@/core/events';
import { refreshOrchestrator, useBackgroundRefresh } from '@/core/refresh';
import { clusterReadiness } from '@/core/refresh/clusterReadiness';
import { getWindowIdentity } from '@/core/window-identity';
import {
  buildSelectionTransitionPlan,
  normalizeSelections,
  resolveClusterMeta,
  resolveNextActiveSelection,
  retainedActiveSelection,
  type SelectionTransitionPlan,
  selectedClusterIdsFor,
} from './kubeconfigSelection';

export type KubeconfigDiscoveryState = 'available' | 'search_paths_missing' | 'no_kubeconfigs';

export interface ClusterClosePreparation {
  release: () => void;
}
type ClusterClosePreflight = (clusterId: string) => Promise<ClusterClosePreparation | null>;

async function prepareClusterClose(
  preflights: Iterable<ClusterClosePreflight>,
  clusterId: string
): Promise<ClusterClosePreparation | null> {
  const preparations: ClusterClosePreparation[] = [];
  const release = () =>
    preparations.forEach((preparation) => {
      preparation.release();
    });
  try {
    for (const preflight of preflights) {
      const preparation = await preflight(clusterId);
      if (!preparation) {
        release();
        return null;
      }
      preparations.push(preparation);
    }
    return { release };
  } catch (error) {
    release();
    throw error;
  }
}

const resolveKubeconfigDiscoveryState = (
  state: string,
  kubeconfigs: types.KubeconfigInfo[]
): KubeconfigDiscoveryState => {
  if (state === 'search_paths_missing' || state === 'no_kubeconfigs' || state === 'available') {
    return state;
  }
  return kubeconfigs.length > 0 ? 'available' : 'no_kubeconfigs';
};

interface KubeconfigContextType {
  kubeconfigs: types.KubeconfigInfo[];
  kubeconfigDiscoveryState: KubeconfigDiscoveryState;
  kubeconfigSearchPaths: string[];
  selectedKubeconfigs: string[];
  selectedKubeconfig: string;
  selectedClusterId: string;
  selectedClusterName: string;
  selectedClusterIds: string[];
  kubeconfigsLoading: boolean;
  setSelectedKubeconfigs: (configs: string[]) => Promise<void>;
  openKubeconfig: (selection: string) => Promise<void>;
  closeKubeconfig: (selectionOrClusterId: string) => Promise<void>;
  setActiveKubeconfig: (config: string) => void;
  getClusterMeta: (config: string) => { id: string; name: string };
  loadKubeconfigs: (refreshWorkspace?: boolean) => Promise<void>;
  registerClusterClosePreflight: (preflight: ClusterClosePreflight) => () => void;
}

const KubeconfigContext = createContext<KubeconfigContextType | undefined>(undefined);

export const useKubeconfig = () => {
  const context = useContext(KubeconfigContext);
  if (!context) {
    throw new Error('useKubeconfig must be used within KubeconfigProvider');
  }
  return context;
};

interface KubeconfigProviderProps {
  children: ReactNode;
}

interface FixedClusterProviderProps {
  children: ReactNode;
  clusterId: string;
  clusterName?: string;
}

/**
 * Read-only cluster identity for a native panel webview. It deliberately omits
 * KubeconfigProvider's workspace acquisition and selection transitions: the
 * owner workspace already owns this open cluster tab.
 */
export const FixedClusterProvider: React.FC<FixedClusterProviderProps> = ({
  children,
  clusterId,
  clusterName = clusterId,
}) => {
  const value = useMemo<KubeconfigContextType>(
    () => ({
      kubeconfigs: [],
      kubeconfigDiscoveryState: 'available',
      kubeconfigSearchPaths: [],
      selectedKubeconfigs: [clusterId],
      selectedKubeconfig: clusterId,
      selectedClusterId: clusterId,
      selectedClusterName: clusterName,
      selectedClusterIds: [clusterId],
      kubeconfigsLoading: false,
      setSelectedKubeconfigs: async () => undefined,
      openKubeconfig: async () => undefined,
      closeKubeconfig: async () => undefined,
      setActiveKubeconfig: () => undefined,
      getClusterMeta: () => ({ id: clusterId, name: clusterName }),
      loadKubeconfigs: async () => undefined,
      registerClusterClosePreflight: () => () => undefined,
    }),
    [clusterId, clusterName]
  );
  return <KubeconfigContext.Provider value={value}>{children}</KubeconfigContext.Provider>;
};

type SelectionTransitionOptions = {
  configs: string[];
  requestId: number;
  activeSelection?: string;
  context: string;
  errorMessage: string;
};

type SelectionTransitionResult = Awaited<ReturnType<typeof ApplyClusterWorkspace>>;

export const KubeconfigProvider: React.FC<KubeconfigProviderProps> = ({ children }) => {
  const [kubeconfigs, setKubeconfigs] = useState<types.KubeconfigInfo[]>([]);
  const [kubeconfigDiscoveryState, setKubeconfigDiscoveryState] =
    useState<KubeconfigDiscoveryState>('available');
  const [kubeconfigSearchPaths, setKubeconfigSearchPaths] = useState<string[]>([]);
  const [selectedKubeconfigs, setSelectedKubeconfigsState] = useState<string[]>([]);
  const [selectedKubeconfig, setSelectedKubeconfigState] = useState<string>('');
  const [committedSelectedKubeconfigs, setCommittedSelectedKubeconfigs] = useState<string[]>([]);
  const [committedSelectedKubeconfig, setCommittedSelectedKubeconfig] = useState<string>('');
  const [kubeconfigsLoading, setKubeconfigsLoading] = useState(true);
  const { enabled: backgroundRefreshEnabled } = useBackgroundRefresh();
  const kubeconfigsRef = useRef<types.KubeconfigInfo[]>([]);
  const selectedKubeconfigsRef = useRef<string[]>([]);
  const selectedKubeconfigRef = useRef<string>('');
  const committedSelectionsRef = useRef<string[]>([]);
  const committedActiveRef = useRef<string>('');
  const latestSelectionRequestIdRef = useRef(0);
  const clusterClosePreflightsRef = useRef(new Set<ClusterClosePreflight>());
  const closingClusterIdsRef = useRef(new Set<string>());
  // Prevent refresh context churn until the backend confirms selection updates.
  const selectionPendingRef = useRef(false);

  useEffect(() => clusterWorkspaceStore.acquire(), []);

  // Public selection follows the active tab immediately so cluster-scoped UI
  // cannot keep rendering the previous cluster while activation is pending.
  const selectedClusterMeta = useMemo(
    () => resolveClusterMeta(selectedKubeconfig, kubeconfigs),
    [selectedKubeconfig, kubeconfigs]
  );

  // Refresh selection stays on the last backend-confirmed open set. A switch
  // among those already-open tabs commits immediately below.
  const committedSelectedClusterMeta = useMemo(
    () => resolveClusterMeta(committedSelectedKubeconfig, kubeconfigs),
    [committedSelectedKubeconfig, kubeconfigs]
  );

  useEffect(() => {
    kubeconfigsRef.current = kubeconfigs;
  }, [kubeconfigs]);

  useEffect(() => {
    selectedKubeconfigsRef.current = selectedKubeconfigs;
  }, [selectedKubeconfigs]);

  useEffect(() => {
    selectedKubeconfigRef.current = selectedKubeconfig;
  }, [selectedKubeconfig]);

  const getClusterMeta = useCallback(
    (selection: string) => resolveClusterMeta(selection, kubeconfigs),
    [kubeconfigs]
  );

  const selectedClusterIds = useMemo(
    () => selectedClusterIdsFor(selectedKubeconfigs, kubeconfigs),
    [kubeconfigs, selectedKubeconfigs]
  );

  const committedSelectedClusterIds = useMemo(
    () => selectedClusterIdsFor(committedSelectedKubeconfigs, kubeconfigs),
    [committedSelectedKubeconfigs, kubeconfigs]
  );

  const updateRefreshContext = useCallback(
    (meta: { id: string; name: string }, clusterIds: string[]) => {
      // Foreground view-specific domains only refresh for the active cluster.
      const foregroundClusterIds = meta.id ? [meta.id] : [];
      refreshOrchestrator.updateContext({
        selectedClusterId: meta.id || undefined,
        selectedClusterName: meta.name || undefined,
        selectedClusterIds: foregroundClusterIds,
        // This is the open/connected cluster set used for runtime disposal.
        // Background refresh eligibility is controlled separately by
        // useBackgroundClusterRefresh, so disabling background refresh must not
        // make inactive open tabs look disconnected.
        allConnectedClusterIds: clusterIds,
        backgroundRefreshEnabled,
      });
    },
    [backgroundRefreshEnabled]
  );

  // Keep refresh context aligned with the active kubeconfig selection.
  useEffect(() => {
    if (selectionPendingRef.current) {
      return;
    }
    updateRefreshContext(committedSelectedClusterMeta, committedSelectedClusterIds);
  }, [committedSelectedClusterIds, committedSelectedClusterMeta, updateRefreshContext]);

  const activateVisibleCluster = useCallback((clusterId: string, reportFailure = false) => {
    clusterReadiness.beginForegroundActivation(clusterId);
    void ApplyClusterWorkspace({
      windowId: getWindowIdentity(),
      selectedKubeconfigs: [],
      updateSelectedKubeconfigs: false,
      visibleClusterId: clusterId,
    })
      .then((result) => {
        clusterWorkspaceStore.applyWireState(result.state);
        if (result.error) {
          throw new Error(result.error);
        }
      })
      .catch((error) => {
        if (reportFailure) {
          errorHandler.handle(
            error,
            { action: 'activateInitialCluster' },
            'Failed to activate the initial cluster'
          );
        }
      })
      .finally(() => {
        clusterReadiness.endForegroundActivation(clusterId);
      });
  }, []);

  const applyVisibleSelection = useCallback((selections: string[], activeSelection: string) => {
    selectedKubeconfigsRef.current = selections;
    selectedKubeconfigRef.current = activeSelection;
    setSelectedKubeconfigsState(selections);
    setSelectedKubeconfigState(activeSelection);
  }, []);

  const applyCommittedSelection = useCallback((selections: string[], activeSelection: string) => {
    committedSelectionsRef.current = selections;
    committedActiveRef.current = activeSelection;
    setCommittedSelectedKubeconfigs(selections);
    setCommittedSelectedKubeconfig(activeSelection);
  }, []);

  const loadKubeconfigs = useCallback(
    async (refreshWorkspace = false) => {
      setKubeconfigsLoading(true);
      try {
        // Load both the list of configs and the currently selected list.
        const [discovery, currentSelection] = await Promise.all([
          requestAppState({
            resource: 'kubeconfigs',
            read: () => readKubeconfigs(),
          }),
          refreshWorkspace ? clusterWorkspaceStore.refresh() : clusterWorkspaceStore.hydrate(),
        ]);

        const configs = discovery.kubeconfigs || [];
        setKubeconfigs(configs);
        setKubeconfigDiscoveryState(resolveKubeconfigDiscoveryState(discovery.state, configs));
        setKubeconfigSearchPaths(discovery.searchPaths || []);
        // Set the selection from the backend
        const normalizedSelection = normalizeSelections(
          currentSelection?.selectedKubeconfigs || []
        );
        const activeSelection = retainedActiveSelection(
          normalizedSelection,
          selectedKubeconfigRef.current
        );
        const initialMeta = resolveClusterMeta(activeSelection, configs);
        applyVisibleSelection(normalizedSelection, activeSelection);
        applyCommittedSelection(normalizedSelection, activeSelection);
        if (initialMeta.id) {
          activateVisibleCluster(initialMeta.id, true);
        }
      } catch (error) {
        errorHandler.handle(
          error,
          {
            context: 'loadKubeconfigs',
          },
          'Failed to load kubeconfigs'
        );
        setKubeconfigs([]);
      } finally {
        setKubeconfigsLoading(false);
      }
    },
    [activateVisibleCluster, applyVisibleSelection, applyCommittedSelection]
  );

  const beginSelectionTransition = useCallback(
    (plan: SelectionTransitionPlan) => {
      selectionPendingRef.current = true;
      applyVisibleSelection(plan.normalizedSelections, plan.nextActive);
      if (plan.shouldEmitChanging) {
        eventBus.emit('kubeconfig:changing', '');
      }
    },
    [applyVisibleSelection]
  );

  const completeSelectionTransition = useCallback(
    (plan: SelectionTransitionPlan, result: SelectionTransitionResult) => {
      clusterWorkspaceStore.applyWireState(result.state);
      if (result.error) {
        throw new Error(result.error);
      }
      const confirmedSelections = normalizeSelections(result.state.selectedKubeconfigs || []);
      const confirmedActive = retainedActiveSelection(confirmedSelections, plan.nextActive);
      applyVisibleSelection(confirmedSelections, confirmedActive);
      if (plan.shouldEmitSelectionChanged) {
        eventBus.emit('kubeconfig:selection-changed');
      }
      selectionPendingRef.current = false;
      applyCommittedSelection(confirmedSelections, confirmedActive);
      if (plan.shouldEmitChanged) {
        eventBus.emit('kubeconfig:changed', '');
      }
    },
    [applyCommittedSelection, applyVisibleSelection]
  );

  const rollbackSelectionTransition = useCallback(() => {
    selectionPendingRef.current = false;
    const workspaceSelections = normalizeSelections([
      ...clusterWorkspaceStore.getSnapshot().selectedKubeconfigs,
    ]);
    const rollbackSelections =
      workspaceSelections.length === 0 && committedSelectionsRef.current.length > 0
        ? committedSelectionsRef.current
        : workspaceSelections;
    const rollbackActive = retainedActiveSelection(rollbackSelections, committedActiveRef.current);
    applyCommittedSelection(rollbackSelections, rollbackActive);
    applyVisibleSelection(rollbackSelections, rollbackActive);
  }, [applyCommittedSelection, applyVisibleSelection]);

  const applySelectionTransition = useCallback(
    async ({
      configs,
      requestId,
      activeSelection,
      context,
      errorMessage,
    }: SelectionTransitionOptions) => {
      const previousSelections = selectedKubeconfigsRef.current;
      const previousActive = selectedKubeconfigRef.current;
      const normalizedSelections = normalizeSelections(configs);
      const plan = buildSelectionTransitionPlan(
        previousSelections,
        previousActive,
        normalizedSelections,
        activeSelection,
        kubeconfigsRef.current
      );

      try {
        beginSelectionTransition(plan);
        const result = await ApplyClusterWorkspace({
          windowId: getWindowIdentity(),
          selectedKubeconfigs: plan.normalizedSelections,
          updateSelectedKubeconfigs: true,
          visibleClusterId: plan.nextClusterId,
        });

        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }
        completeSelectionTransition(plan, result);
      } catch (error) {
        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }
        rollbackSelectionTransition();
        errorHandler.handle(
          error,
          {
            context,
            configs: normalizedSelections,
          },
          errorMessage
        );
        throw error;
      }
    },
    [beginSelectionTransition, completeSelectionTransition, rollbackSelectionTransition]
  );

  const setSelectedKubeconfigs = useCallback(
    (configs: string[]) => {
      const requestId = latestSelectionRequestIdRef.current + 1;
      latestSelectionRequestIdRef.current = requestId;
      return applySelectionTransition({
        configs,
        requestId,
        context: 'setSelectedKubeconfigs',
        errorMessage: 'Failed to set kubeconfigs',
      });
    },
    [applySelectionTransition]
  );

  const openKubeconfig = useCallback(
    async (selection: string) => {
      const target = selection.trim();
      if (!target) {
        return;
      }

      const requestId = latestSelectionRequestIdRef.current + 1;
      latestSelectionRequestIdRef.current = requestId;

      const previousSelections = selectedKubeconfigsRef.current;
      const nextSelections = previousSelections.includes(target)
        ? previousSelections
        : [...previousSelections, target];
      await applySelectionTransition({
        configs: nextSelections,
        requestId,
        activeSelection: target,
        context: 'openKubeconfig',
        errorMessage: 'Failed to open cluster',
      });
    },
    [applySelectionTransition]
  );

  const closeKubeconfig = useCallback(
    async (selectionOrClusterId: string) => {
      const target = selectionOrClusterId.trim();
      if (!target) {
        return;
      }

      const targetSelection = selectedKubeconfigsRef.current.find((selection) => {
        if (selection === target) {
          return true;
        }
        return resolveClusterMeta(selection, kubeconfigsRef.current).id === target;
      });
      if (!targetSelection) {
        return;
      }
      const targetClusterId = resolveClusterMeta(targetSelection, kubeconfigsRef.current).id;
      if (closingClusterIdsRef.current.has(targetClusterId)) {
        return;
      }
      closingClusterIdsRef.current.add(targetClusterId);
      let preparation: ClusterClosePreparation | null = null;
      try {
        preparation = await prepareClusterClose(clusterClosePreflightsRef.current, targetClusterId);
        if (!preparation) {
          return;
        }
        const remaining = selectedKubeconfigsRef.current.filter(
          (selection) =>
            resolveClusterMeta(selection, kubeconfigsRef.current).id !== targetClusterId
        );
        clusterWorkspaceStore.confirmClosedSelection(targetSelection, targetClusterId);
        applyCommittedSelection(
          remaining,
          resolveNextActiveSelection(
            selectedKubeconfigsRef.current,
            selectedKubeconfigRef.current,
            remaining
          )
        );
        const requestId = ++latestSelectionRequestIdRef.current;
        await applySelectionTransition({
          configs: remaining,
          requestId,
          context: 'closeKubeconfig',
          errorMessage: 'Failed to close cluster',
        });
      } finally {
        preparation?.release();
        closingClusterIdsRef.current.delete(targetClusterId);
      }
    },
    [applySelectionTransition, applyCommittedSelection]
  );

  const registerClusterClosePreflight = useCallback((preflight: ClusterClosePreflight) => {
    const preflights = clusterClosePreflightsRef.current;
    preflights.add(preflight);
    return () => preflights.delete(preflight);
  }, []);

  const setActiveKubeconfig = useCallback(
    (config: string) => {
      if (!config || config === selectedKubeconfig) {
        return;
      }
      if (!selectedKubeconfigs.includes(config)) {
        return;
      }
      selectedKubeconfigRef.current = config;
      setSelectedKubeconfigState(config);
      if (committedSelectionsRef.current.includes(config)) {
        // An already-open tab owns retained, cluster-scoped data. Publish its
        // identity immediately so consumers can repaint that snapshot while
        // backend foreground activation proceeds independently.
        committedActiveRef.current = config;
        setCommittedSelectedKubeconfig(config);
        const meta = resolveClusterMeta(config, kubeconfigsRef.current);
        if (meta.id) {
          // Foreground activation starts immediately but does not gate retained
          // data. Hold new refresh dispatch until the backend has re-established
          // producers for a cooled cluster; the retained snapshot remains
          // visible throughout this activation window.
          activateVisibleCluster(meta.id);
        }
      }
    },
    [activateVisibleCluster, selectedKubeconfig, selectedKubeconfigs]
  );

  // Load kubeconfigs on mount
  useEffect(() => {
    loadKubeconfigs();
  }, [loadKubeconfigs]);

  // Listen for backend kubeconfig watcher refresh events.
  useEffect(() => {
    const cancel = onEvent('kubeconfig:available-changed', () => {
      void loadKubeconfigs(true);
    });

    return () => {
      if (typeof cancel === 'function') {
        cancel();
      }
    };
  }, [loadKubeconfigs]);

  // Run GridTable persistence GC when kubeconfigs change or selection changes
  useEffect(() => {
    const runGC = async () => {
      const identities = new Set<string>();
      kubeconfigs.forEach((config) => {
        if (config.name && config.context) {
          identities.add(`${config.name}:${config.context}`);
        }
      });
      selectedClusterIds.forEach((id) => {
        identities.add(id);
      });
      const hashes = await computeClusterHashes(Array.from(identities));
      await runGridTableGC({ activeClusterHashes: hashes });
    };

    void runGC();
  }, [kubeconfigs, selectedClusterIds]);

  // Memoize context value
  const contextValue = useMemo(
    () => ({
      kubeconfigs,
      kubeconfigDiscoveryState,
      kubeconfigSearchPaths,
      selectedKubeconfigs,
      selectedKubeconfig,
      // Cluster-scoped UI follows the selected tab immediately; refresh context
      // remains backend-confirmed through committedSelectedClusterMeta above.
      selectedClusterId: selectedClusterMeta.id,
      selectedClusterName: selectedClusterMeta.name,
      selectedClusterIds,
      kubeconfigsLoading,
      setSelectedKubeconfigs,
      openKubeconfig,
      closeKubeconfig,
      setActiveKubeconfig,
      getClusterMeta,
      loadKubeconfigs,
      registerClusterClosePreflight,
    }),
    [
      kubeconfigs,
      kubeconfigDiscoveryState,
      kubeconfigSearchPaths,
      selectedKubeconfigs,
      selectedKubeconfig,
      selectedClusterMeta.id,
      selectedClusterMeta.name,
      selectedClusterIds,
      kubeconfigsLoading,
      setSelectedKubeconfigs,
      openKubeconfig,
      closeKubeconfig,
      setActiveKubeconfig,
      getClusterMeta,
      loadKubeconfigs,
      registerClusterClosePreflight,
    ]
  );

  return <KubeconfigContext.Provider value={contextValue}>{children}</KubeconfigContext.Provider>;
};
