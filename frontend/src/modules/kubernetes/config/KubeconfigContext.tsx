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
  /** The cluster committed by native close, or null for a guard-only participant. */
  committedClusterId: string | null;
  release: () => void;
}
export type ClusterClosePreflight = (
  clusterId: string,
  admitted: Promise<void>
) => Promise<ClusterClosePreparation | null>;

async function prepareClusterClose(
  preflights: readonly ClusterClosePreflight[],
  clusterId: string,
  admitted: Promise<void>
): Promise<ClusterClosePreparation | null> {
  const preparations: ClusterClosePreparation[] = [];
  const release = () =>
    preparations.forEach((preparation) => {
      preparation.release();
    });
  try {
    for (const preflight of preflights) {
      const preparation = await preflight(clusterId, admitted);
      if (!preparation) {
        release();
        return null;
      }
      preparations.push(preparation);
    }
    if (!preparations.some((preparation) => preparation.committedClusterId === clusterId)) {
      throw new Error(`Native cluster close was not committed for ${clusterId}`);
    }
    return { committedClusterId: clusterId, release };
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
  managedKubeconfigs: string[];
  selectedKubeconfig: string;
  selectedClusterId: string;
  selectedClusterName: string;
  selectedClusterIds: string[];
  /** Includes closing tabs until native close accepts their removal. */
  managedClusterIds: string[];
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
      managedKubeconfigs: [clusterId],
      selectedKubeconfig: clusterId,
      selectedClusterId: clusterId,
      selectedClusterName: clusterName,
      selectedClusterIds: [clusterId],
      managedClusterIds: [clusterId],
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
  const [discoveryRefreshPending, setDiscoveryRefreshPending] = useState(false);
  const { enabled: backgroundRefreshEnabled } = useBackgroundRefresh();
  const kubeconfigsRef = useRef<types.KubeconfigInfo[]>([]);
  const selectedKubeconfigsRef = useRef<string[]>([]);
  const selectedKubeconfigRef = useRef<string>('');
  const committedSelectionsRef = useRef<string[]>([]);
  const committedActiveRef = useRef<string>('');
  const latestSelectionRequestIdRef = useRef(0);
  const latestActiveIntentRef = useRef(0);
  const selectionQueueRef = useRef<Promise<void> | null>(null);
  const visibilityQueueRef = useRef<Promise<void> | null>(null);
  const latestVisibilityRequestIdRef = useRef(0);
  const clusterClosePreflightsRef = useRef(new Set<ClusterClosePreflight>());
  const closingClustersRef = useRef(new Map<string, Promise<void>>());
  const closingSelectionsRef = useRef(new Set<string>());
  const [closingSelections, setClosingSelections] = useState<ReadonlySet<string>>(new Set());
  const pendingOpenIntentsRef = useRef(new Map<string, symbol>());
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

  const managedClusterIds = useMemo(
    () => selectedClusterIdsFor(selectedKubeconfigs, kubeconfigs),
    [kubeconfigs, selectedKubeconfigs]
  );
  const visibleSelections = useMemo(
    () => selectedKubeconfigs.filter((selection) => !closingSelections.has(selection)),
    [selectedKubeconfigs, closingSelections]
  );
  const selectedClusterIds = useMemo(
    () => selectedClusterIdsFor(visibleSelections, kubeconfigs),
    [kubeconfigs, visibleSelections]
  );
  const visibleSelectionsFor = useCallback(
    (selections: string[]) =>
      selections.filter((value) => !closingSelectionsRef.current.has(value)),
    []
  );
  const markSelectionClosing = useCallback((selection: string, closing: boolean) => {
    if (closing) {
      closingSelectionsRef.current.add(selection);
    } else {
      closingSelectionsRef.current.delete(selection);
    }
    setClosingSelections(new Set(closingSelectionsRef.current));
  }, []);

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
    const requestId = ++latestVisibilityRequestIdRef.current;
    const selectionRequestId = latestSelectionRequestIdRef.current;
    clusterReadiness.beginForegroundActivation(clusterId);
    const activate = () => {
      if (
        requestId !== latestVisibilityRequestIdRef.current ||
        selectionRequestId !== latestSelectionRequestIdRef.current
      ) {
        return Promise.resolve(null);
      }
      return clusterWorkspaceStore.reconcileCommand(
        () =>
          ApplyClusterWorkspace({
            windowId: getWindowIdentity(),
            selectedKubeconfigs: [],
            updateSelectedKubeconfigs: false,
            visibleClusterId: clusterId,
          }),
        () =>
          requestId === latestVisibilityRequestIdRef.current &&
          selectionRequestId === latestSelectionRequestIdRef.current &&
          !selectionPendingRef.current
      );
    };
    const pending = (visibilityQueueRef.current?.then(activate) ?? activate())
      .then((result) => {
        if (result?.error) {
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
        if (visibilityQueueRef.current === pending) {
          visibilityQueueRef.current = null;
        }
      });
    visibilityQueueRef.current = pending;
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

  const activateSelection = useCallback(
    (config: string) => {
      if (config === selectedKubeconfigRef.current) {
        return;
      }
      selectedKubeconfigRef.current = config;
      setSelectedKubeconfigState(config);
      if (!config || committedSelectionsRef.current.includes(config)) {
        committedActiveRef.current = config;
        setCommittedSelectedKubeconfig(config);
        activateVisibleCluster(resolveClusterMeta(config, kubeconfigsRef.current).id);
      }
    },
    [activateVisibleCluster]
  );

  const hydrateSelection = useCallback(
    (selections: string[], configs: types.KubeconfigInfo[]) => {
      const normalized = normalizeSelections(selections);
      const active = retainedActiveSelection(normalized, selectedKubeconfigRef.current);
      applyVisibleSelection(normalized, active);
      applyCommittedSelection(normalized, active);
      const meta = resolveClusterMeta(active, configs);
      if (meta.id) {
        activateVisibleCluster(meta.id, true);
      }
    },
    [activateVisibleCluster, applyVisibleSelection, applyCommittedSelection]
  );

  const loadKubeconfigs = useCallback(
    async (refreshWorkspace = false) => {
      const requestId = latestSelectionRequestIdRef.current;
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
        if (
          requestId !== latestSelectionRequestIdRef.current ||
          selectionPendingRef.current ||
          closingClustersRef.current.size > 0
        ) {
          setDiscoveryRefreshPending(true);
          return;
        }
        hydrateSelection(currentSelection?.selectedKubeconfigs || [], configs);
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
    [hydrateSelection]
  );

  const selectionWorkPending = selectionPendingRef.current || closingSelections.size > 0;
  useEffect(() => {
    if (!discoveryRefreshPending || kubeconfigsLoading || selectionWorkPending) {
      return;
    }
    setDiscoveryRefreshPending(false);
    void loadKubeconfigs(true);
  }, [discoveryRefreshPending, kubeconfigsLoading, selectionWorkPending, loadKubeconfigs]);

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
    (plan: SelectionTransitionPlan, selections: string[], visibleClusterId: string) => {
      const confirmedSelections = normalizeSelections(selections);
      const confirmedActive = retainedActiveSelection(
        visibleSelectionsFor(confirmedSelections),
        selectedKubeconfigRef.current
      );
      applyVisibleSelection(confirmedSelections, confirmedActive);
      if (plan.shouldEmitSelectionChanged) {
        eventBus.emit('kubeconfig:selection-changed');
      }
      selectionPendingRef.current = false;
      applyCommittedSelection(confirmedSelections, confirmedActive);
      const confirmedMeta = resolveClusterMeta(confirmedActive, kubeconfigsRef.current);
      if (visibilityQueueRef.current || confirmedMeta.id !== visibleClusterId) {
        activateVisibleCluster(confirmedMeta.id);
      }
      if (plan.shouldEmitChanged) {
        eventBus.emit('kubeconfig:changed', '');
      }
    },
    [activateVisibleCluster, applyCommittedSelection, applyVisibleSelection, visibleSelectionsFor]
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
    const rollbackActive = retainedActiveSelection(
      visibleSelectionsFor(rollbackSelections),
      committedActiveRef.current
    );
    applyCommittedSelection(rollbackSelections, rollbackActive);
    applyVisibleSelection(rollbackSelections, rollbackActive);
  }, [applyCommittedSelection, applyVisibleSelection, visibleSelectionsFor]);

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
        const apply = () =>
          clusterWorkspaceStore.reconcileCommand(
            () =>
              ApplyClusterWorkspace({
                windowId: getWindowIdentity(),
                selectedKubeconfigs: plan.normalizedSelections,
                updateSelectedKubeconfigs: true,
                visibleClusterId: plan.nextClusterId,
              }),
            () => requestId === latestSelectionRequestIdRef.current
          );
        const pending = selectionQueueRef.current?.then(apply) ?? apply();
        const settled = pending.then(
          () => undefined,
          () => undefined
        );
        selectionQueueRef.current = settled;
        void settled.then(() => {
          if (selectionQueueRef.current === settled) {
            selectionQueueRef.current = null;
          }
        });
        const result = await pending;

        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }
        if (result.error) {
          throw new Error(result.error);
        }
        completeSelectionTransition(
          plan,
          result.state.selectedKubeconfigs || [],
          result.state.visibleClusterId
        );
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
    async (configs: string[]) => {
      const activeIntent = ++latestActiveIntentRef.current;
      pendingOpenIntentsRef.current.clear();
      if (closingClustersRef.current.size > 0) {
        await Promise.allSettled(closingClustersRef.current.values());
      }
      const requestId = latestSelectionRequestIdRef.current + 1;
      latestSelectionRequestIdRef.current = requestId;
      return applySelectionTransition({
        configs,
        requestId,
        activeSelection:
          activeIntent === latestActiveIntentRef.current
            ? undefined
            : selectedKubeconfigRef.current,
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
      const activeIntent = ++latestActiveIntentRef.current;
      if (closingClustersRef.current.size > 0) {
        const openIntent = Symbol();
        pendingOpenIntentsRef.current.set(target, openIntent);
        await Promise.allSettled(closingClustersRef.current.values());
        if (pendingOpenIntentsRef.current.get(target) !== openIntent) {
          return;
        }
        pendingOpenIntentsRef.current.delete(target);
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
        activeSelection:
          activeIntent === latestActiveIntentRef.current ? target : selectedKubeconfigRef.current,
        context: 'openKubeconfig',
        errorMessage: 'Failed to open cluster',
      });
    },
    [applySelectionTransition]
  );

  const adoptClosedSelection = useCallback(
    (selection: string, clusterId: string) => {
      const previous = selectedKubeconfigsRef.current;
      const remaining = previous.filter((value) => value !== selection);
      const plan = buildSelectionTransitionPlan(
        previous,
        selectedKubeconfigRef.current,
        remaining,
        selectedKubeconfigRef.current,
        kubeconfigsRef.current
      );
      ++latestSelectionRequestIdRef.current;
      // Native close already committed this removal. Replacing membership here
      // could reopen a sibling whose native response is still in flight.
      clusterWorkspaceStore.confirmClosedSelection(selection, clusterId);
      beginSelectionTransition(plan);
      completeSelectionTransition(
        plan,
        remaining,
        clusterWorkspaceStore.getSnapshot().visibleClusterId
      );
      updateRefreshContext(
        resolveClusterMeta(committedActiveRef.current, kubeconfigsRef.current),
        selectedClusterIdsFor(remaining, kubeconfigsRef.current)
      );
    },
    [beginSelectionTransition, completeSelectionTransition, updateRefreshContext]
  );

  const closeKubeconfig = useCallback(
    (selectionOrClusterId: string): Promise<void> => {
      const target = selectionOrClusterId.trim();
      if (!target) {
        return Promise.resolve();
      }

      const targetSelection = selectedKubeconfigsRef.current.find((selection) => {
        if (selection === target) {
          return true;
        }
        return resolveClusterMeta(selection, kubeconfigsRef.current).id === target;
      });
      if (!targetSelection) {
        return Promise.resolve();
      }
      // A second close can supersede a reopen still waiting for the first close.
      pendingOpenIntentsRef.current.delete(targetSelection);
      const targetClusterId = resolveClusterMeta(targetSelection, kubeconfigsRef.current).id;
      const existing = closingClustersRef.current.get(targetClusterId);
      if (existing) {
        return existing;
      }
      const previousActive = selectedKubeconfigRef.current;
      const activeIntent = ++latestActiveIntentRef.current;
      const previousVisible = visibleSelectionsFor(selectedKubeconfigsRef.current);
      const admitted = selectionQueueRef.current ?? Promise.resolve();
      const resumeRequests = clusterWorkspaceStore.holdClusterRequests(targetClusterId);
      const close = async () => {
        let preparation: ClusterClosePreparation | null = null;
        let accepted = false;
        try {
          // Foreground changes can replace registrations while a close is pending.
          // Snapshot this transaction's participants before awaiting any of them.
          preparation = await prepareClusterClose(
            [...clusterClosePreflightsRef.current],
            targetClusterId,
            admitted
          );
          if (!preparation) {
            return;
          }
          await admitted;
          accepted = true;
          adoptClosedSelection(targetSelection, targetClusterId);
        } finally {
          preparation?.release();
          resumeRequests();
          closingClustersRef.current.delete(targetClusterId);
          markSelectionClosing(targetSelection, false);
          if (
            !accepted &&
            previousActive === targetSelection &&
            selectedKubeconfigsRef.current.includes(previousActive) &&
            activeIntent === latestActiveIntentRef.current
          ) {
            activateSelection(previousActive);
          }
        }
      };
      // Capture panel guards before switching away can unmount their controls.
      const pending = close().catch((error) => {
        // Report once for all callers awaiting this close, after cleanup settles.
        errorHandler.handle(
          error,
          { context: 'closeKubeconfig', clusterId: targetClusterId },
          `Failed to close cluster "${targetClusterId}".`
        );
        throw error;
      });
      closingClustersRef.current.set(targetClusterId, pending);
      markSelectionClosing(targetSelection, true);
      activateSelection(
        resolveNextActiveSelection(
          previousVisible,
          previousActive,
          visibleSelectionsFor(selectedKubeconfigsRef.current)
        )
      );
      return pending;
    },
    [adoptClosedSelection, activateSelection, markSelectionClosing, visibleSelectionsFor]
  );

  const registerClusterClosePreflight = useCallback((preflight: ClusterClosePreflight) => {
    const preflights = clusterClosePreflightsRef.current;
    preflights.add(preflight);
    return () => preflights.delete(preflight);
  }, []);

  const setActiveKubeconfig = useCallback(
    (config: string) => {
      if (!config) {
        return;
      }
      if (!visibleSelectionsFor(selectedKubeconfigsRef.current).includes(config)) {
        return;
      }
      latestActiveIntentRef.current++;
      if (config === selectedKubeconfigRef.current) {
        return;
      }
      activateSelection(config);
    },
    [activateSelection, visibleSelectionsFor]
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
      selectedKubeconfigs: visibleSelections,
      managedKubeconfigs: selectedKubeconfigs,
      selectedKubeconfig,
      // Cluster-scoped UI follows the selected tab immediately; refresh context
      // remains backend-confirmed through committedSelectedClusterMeta above.
      selectedClusterId: selectedClusterMeta.id,
      selectedClusterName: selectedClusterMeta.name,
      selectedClusterIds,
      managedClusterIds,
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
      visibleSelections,
      selectedKubeconfigs,
      selectedKubeconfig,
      selectedClusterMeta.id,
      selectedClusterMeta.name,
      selectedClusterIds,
      managedClusterIds,
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
