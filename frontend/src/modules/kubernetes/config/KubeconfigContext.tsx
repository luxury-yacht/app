/**
 * frontend/src/modules/kubernetes/config/KubeconfigContext.tsx
 *
 * Context and provider for KubeconfigContext.
 * Defines shared state and accessors for the kubernetes feature.
 */

import type { types } from '@core/backend-api/models';
import { onEvent } from '@core/desktop-runtime';
import {
  getClusterTabOrder,
  getNextClusterTabSelectionAfterClose,
} from '@core/persistence/clusterTabOrder';
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

export type KubeconfigDiscoveryState = 'available' | 'search_paths_missing' | 'no_kubeconfigs';

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
  loadKubeconfigs: () => Promise<void>;
}

const KubeconfigContext = createContext<KubeconfigContextType | undefined>(undefined);

const hasWindowsDrivePrefix = (value: string): boolean => {
  if (!value || value.length < 2) {
    return false;
  }
  const first = value[0];
  const isAlpha = (first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z');
  if (!isAlpha || value[1] !== ':') {
    return false;
  }
  if (value.length === 2) {
    return true;
  }
  return value[2] !== ':';
};

const splitSelectionComponents = (selection: string): { path: string; context: string } => {
  const trimmed = selection.trim();
  if (!trimmed) {
    return { path: '', context: '' };
  }
  const startIndex = hasWindowsDrivePrefix(trimmed) ? 2 : 0;
  const delimiterIndex = trimmed.indexOf(':', startIndex);
  if (delimiterIndex === -1) {
    return { path: trimmed, context: '' };
  }
  return {
    path: trimmed.slice(0, delimiterIndex),
    context: trimmed.slice(delimiterIndex + 1),
  };
};

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

type SelectionTransitionOptions = {
  configs: string[];
  requestId: number;
  activeSelection?: string;
  context: string;
  errorMessage: string;
};

type SelectionTransitionResult = Awaited<ReturnType<typeof ApplyClusterWorkspace>>;

const resolveActiveAfterClose = (
  previousSelections: string[],
  previousActive: string,
  normalizedSelections: string[]
): string => {
  const removedSelections = previousSelections.filter(
    (selection) => !normalizedSelections.includes(selection)
  );
  if (removedSelections.length !== 1) {
    return normalizedSelections[0] || '';
  }
  const nextAfterClose = getNextClusterTabSelectionAfterClose(
    previousSelections,
    removedSelections[0],
    previousActive,
    getClusterTabOrder()
  );
  return nextAfterClose && normalizedSelections.includes(nextAfterClose)
    ? nextAfterClose
    : normalizedSelections[0] || '';
};

const resolveNextActiveSelection = (
  previousSelections: string[],
  previousActive: string,
  normalizedSelections: string[],
  activeSelection?: string
): string => {
  if (activeSelection !== undefined) {
    return normalizedSelections.includes(activeSelection) ? activeSelection : '';
  }
  const addedSelections = normalizedSelections.filter(
    (selection) => !previousSelections.includes(selection)
  );
  if (addedSelections.length > 0) {
    return addedSelections[addedSelections.length - 1];
  }
  if (previousActive && !normalizedSelections.includes(previousActive)) {
    return resolveActiveAfterClose(previousSelections, previousActive, normalizedSelections);
  }
  return previousActive && normalizedSelections.includes(previousActive)
    ? previousActive
    : normalizedSelections[0] || '';
};

interface SelectionTransitionPlan {
  normalizedSelections: string[];
  nextActive: string;
  nextClusterId: string;
  shouldEmitChanging: boolean;
  shouldEmitChanged: boolean;
  shouldEmitSelectionChanged: boolean;
}

const selectionsAreEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((selection, index) => selection === right[index]);

const buildSelectionTransitionPlan = (
  previousSelections: string[],
  previousActive: string,
  normalizedSelections: string[],
  activeSelection: string | undefined,
  nextClusterId: string
): SelectionTransitionPlan => {
  const nextActive = resolveNextActiveSelection(
    previousSelections,
    previousActive,
    normalizedSelections,
    activeSelection
  );
  const wasEmpty = previousSelections.length === 0;
  const willBeEmpty = normalizedSelections.length === 0;
  const selectionChanged = !selectionsAreEqual(previousSelections, normalizedSelections);
  return {
    normalizedSelections,
    nextActive,
    nextClusterId,
    shouldEmitChanging: selectionChanged && willBeEmpty,
    shouldEmitChanged: !willBeEmpty && wasEmpty,
    shouldEmitSelectionChanged: selectionChanged && !willBeEmpty,
  };
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
  const { enabled: backgroundRefreshEnabled } = useBackgroundRefresh();
  const kubeconfigsRef = useRef<types.KubeconfigInfo[]>([]);
  const selectedKubeconfigsRef = useRef<string[]>([]);
  const selectedKubeconfigRef = useRef<string>('');
  const committedSelectionsRef = useRef<string[]>([]);
  const committedActiveRef = useRef<string>('');
  const latestSelectionRequestIdRef = useRef(0);
  // Prevent refresh context churn until the backend confirms selection updates.
  const selectionPendingRef = useRef(false);

  useEffect(() => clusterWorkspaceStore.acquire(), []);

  // Resolve cluster identity metadata from the current selection and config list.
  const resolveClusterMeta = useCallback((selection: string, configs: types.KubeconfigInfo[]) => {
    const trimmed = selection.trim();
    if (!trimmed) {
      return { id: '', name: '' };
    }

    const { path, context } = splitSelectionComponents(trimmed);

    const match = configs.find((config) => config.path === path && config.context === context);
    if (match) {
      return { id: `${match.name}:${match.context}`, name: match.context };
    }

    const pathParts = path.split(/[/\\]/);
    const filename = pathParts[pathParts.length - 1] ?? '';
    if (!filename && !context) {
      return { id: '', name: '' };
    }
    if (!context) {
      return { id: filename, name: '' };
    }
    if (!filename) {
      return { id: context, name: context };
    }
    return { id: `${filename}:${context}`, name: context };
  }, []);

  // Public selection follows the active tab immediately so cluster-scoped UI
  // cannot keep rendering the previous cluster while activation is pending.
  const selectedClusterMeta = useMemo(
    () => resolveClusterMeta(selectedKubeconfig, kubeconfigs),
    [resolveClusterMeta, selectedKubeconfig, kubeconfigs]
  );

  // Refresh selection stays on the last backend-confirmed open set. A switch
  // among those already-open tabs commits immediately below.
  const committedSelectedClusterMeta = useMemo(
    () => resolveClusterMeta(committedSelectedKubeconfig, kubeconfigs),
    [resolveClusterMeta, committedSelectedKubeconfig, kubeconfigs]
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
    [resolveClusterMeta, kubeconfigs]
  );

  const normalizeSelections = useCallback((selections: string[]) => {
    const deduped: string[] = [];
    const seenSelections = new Set<string>();

    selections.forEach((selection) => {
      const trimmed = selection.trim();
      if (!trimmed) {
        return;
      }

      // Dedupe by full selection string (path:context) to allow the same context name
      // from different kubeconfig files (e.g., "dev" in both ~/.kube/config and ~/.kube/staging).
      if (seenSelections.has(trimmed)) {
        return;
      }
      seenSelections.add(trimmed);

      deduped.push(trimmed);
    });

    return deduped;
  }, []);

  const selectedClusterIds = useMemo(() => {
    const ids = new Set<string>();
    selectedKubeconfigs.forEach((selection) => {
      const id = resolveClusterMeta(selection, kubeconfigs).id;
      if (id) {
        ids.add(id);
      }
    });
    return Array.from(ids);
  }, [kubeconfigs, resolveClusterMeta, selectedKubeconfigs]);

  const committedSelectedClusterIds = useMemo(() => {
    const ids = new Set<string>();
    committedSelectedKubeconfigs.forEach((selection) => {
      const id = resolveClusterMeta(selection, kubeconfigs).id;
      if (id) {
        ids.add(id);
      }
    });
    return Array.from(ids);
  }, [committedSelectedKubeconfigs, kubeconfigs, resolveClusterMeta]);

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
        const initialMeta = resolveClusterMeta(normalizedSelection[0] || '', configs);
        if (initialMeta.id) {
          const activation = await ApplyClusterWorkspace({
            windowId: getWindowIdentity(),
            selectedKubeconfigs: [],
            updateSelectedKubeconfigs: false,
            visibleClusterId: initialMeta.id,
          });
          clusterWorkspaceStore.applyWireState(activation.state);
          if (activation.error) {
            throw new Error(activation.error);
          }
        }
        selectedKubeconfigsRef.current = normalizedSelection;
        selectedKubeconfigRef.current = normalizedSelection[0] || '';
        committedSelectionsRef.current = normalizedSelection;
        committedActiveRef.current = normalizedSelection[0] || '';
        setSelectedKubeconfigsState(normalizedSelection);
        setSelectedKubeconfigState(normalizedSelection[0] || '');
        setCommittedSelectedKubeconfigs(normalizedSelection);
        setCommittedSelectedKubeconfig(normalizedSelection[0] || '');
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
    [normalizeSelections, resolveClusterMeta]
  );

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
      const confirmedActive = confirmedSelections.includes(plan.nextActive)
        ? plan.nextActive
        : confirmedSelections[0] || '';
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
    [applyCommittedSelection, applyVisibleSelection, normalizeSelections]
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
    const committedActive = committedActiveRef.current;
    const rollbackActive =
      committedActive && rollbackSelections.includes(committedActive)
        ? committedActive
        : rollbackSelections[0] || '';
    applyCommittedSelection(rollbackSelections, rollbackActive);
    applyVisibleSelection(rollbackSelections, rollbackActive);
  }, [applyCommittedSelection, applyVisibleSelection, normalizeSelections]);

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
      const nextActive = resolveNextActiveSelection(
        previousSelections,
        previousActive,
        normalizedSelections,
        activeSelection
      );
      const nextMeta = resolveClusterMeta(nextActive, kubeconfigsRef.current);
      const plan = buildSelectionTransitionPlan(
        previousSelections,
        previousActive,
        normalizedSelections,
        activeSelection,
        nextMeta.id
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
    [
      beginSelectionTransition,
      completeSelectionTransition,
      normalizeSelections,
      resolveClusterMeta,
      rollbackSelectionTransition,
    ]
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

      const requestId = latestSelectionRequestIdRef.current + 1;
      latestSelectionRequestIdRef.current = requestId;

      const previousSelections = selectedKubeconfigsRef.current;
      const matchesTarget = (selection: string) => {
        if (selection === target) {
          return true;
        }
        return resolveClusterMeta(selection, kubeconfigsRef.current).id === target;
      };
      const normalizedSelections = normalizeSelections(
        previousSelections.filter((selection) => !matchesTarget(selection))
      );
      await applySelectionTransition({
        configs: normalizedSelections,
        requestId,
        context: 'closeKubeconfig',
        errorMessage: 'Failed to close cluster',
      });
    },
    [applySelectionTransition, normalizeSelections, resolveClusterMeta]
  );

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
          clusterReadiness.beginForegroundActivation(meta.id);
          void ApplyClusterWorkspace({
            windowId: getWindowIdentity(),
            selectedKubeconfigs: [],
            updateSelectedKubeconfigs: false,
            visibleClusterId: meta.id,
          })
            .then((result) => {
              clusterWorkspaceStore.applyWireState(result.state);
              if (result.error) {
                throw new Error(result.error);
              }
            })
            .catch(() => {
              // The retained snapshot remains usable if the Wails binding is
              // temporarily unavailable; once the hold releases, the refresh
              // path reports any persistent backend error itself.
            })
            .finally(() => {
              clusterReadiness.endForegroundActivation(meta.id);
            });
        }
      }
    },
    [resolveClusterMeta, selectedKubeconfig, selectedKubeconfigs]
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
    ]
  );

  return <KubeconfigContext.Provider value={contextValue}>{children}</KubeconfigContext.Provider>;
};
