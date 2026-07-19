/**
 * frontend/src/modules/kubernetes/config/KubeconfigContext.tsx
 *
 * Context and provider for KubeconfigContext.
 * Defines shared state and accessors for the kubernetes feature.
 */

import {
  getClusterTabOrder,
  getNextClusterTabSelectionAfterClose,
} from '@core/persistence/clusterTabOrder';
import {
  computeClusterHashes,
  runGridTableGC,
} from '@shared/components/tables/persistence/gridTablePersistenceGC';
import { errorHandler } from '@utils/errorHandler';
import type { types } from '@wailsjs/go/models';
import { EventsOn } from '@wailsjs/runtime/runtime';
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
import { readKubeconfigs, readSelectedKubeconfigs, requestAppState } from '@/core/app-state-access';
import { SetSelectedKubeconfigs, SetVisibleCluster } from '@/core/backend-api';
import { eventBus } from '@/core/events';
import { logAppLogsInfo } from '@/core/logging/appLogsClient';
import { refreshOrchestrator, useBackgroundRefresh } from '@/core/refresh';

interface KubeconfigContextType {
  kubeconfigs: types.KubeconfigInfo[];
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

export const KubeconfigProvider: React.FC<KubeconfigProviderProps> = ({ children }) => {
  const [kubeconfigs, setKubeconfigs] = useState<types.KubeconfigInfo[]>([]);
  const [selectedKubeconfigs, setSelectedKubeconfigsState] = useState<string[]>([]);
  const [selectedKubeconfig, setSelectedKubeconfigState] = useState<string>('');
  const [committedSelectedKubeconfigs, setCommittedSelectedKubeconfigs] = useState<string[]>([]);
  const [committedSelectedKubeconfig, setCommittedSelectedKubeconfig] = useState<string>('');
  const [kubeconfigsLoading, setKubeconfigsLoading] = useState(false);
  const { enabled: backgroundRefreshEnabled } = useBackgroundRefresh();
  const kubeconfigsRef = useRef<types.KubeconfigInfo[]>([]);
  const selectedKubeconfigsRef = useRef<string[]>([]);
  const selectedKubeconfigRef = useRef<string>('');
  const committedSelectionsRef = useRef<string[]>([]);
  const committedActiveRef = useRef<string>('');
  const latestSelectionRequestIdRef = useRef(0);
  const latestForegroundActivationRequestIdRef = useRef(0);
  // Prevent refresh context churn until the backend confirms selection updates.
  const selectionPendingRef = useRef(false);

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

  // The selection strings can move optimistically for tab chrome, while the
  // cluster-data identity below remains committed to backend-ready state.
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

  const loadKubeconfigs = useCallback(async () => {
    setKubeconfigsLoading(true);
    try {
      // Load both the list of configs and the currently selected list.
      const [configs, currentSelection] = await Promise.all([
        requestAppState({
          resource: 'kubeconfigs',
          read: () => readKubeconfigs(),
        }),
        requestAppState({
          resource: 'selected-kubeconfigs',
          read: () => readSelectedKubeconfigs(),
        }),
      ]);

      setKubeconfigs(configs || []);

      // Set the selection from the backend
      const normalizedSelection = normalizeSelections(currentSelection || []);
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
  }, [normalizeSelections]);

  const resolveNextActiveSelection = useCallback(
    (
      previousSelections: string[],
      previousActive: string,
      normalizedSelections: string[],
      activeSelection?: string
    ) => {
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
        const removedSelections = previousSelections.filter(
          (selection) => !normalizedSelections.includes(selection)
        );
        if (removedSelections.length === 1) {
          const nextAfterClose = getNextClusterTabSelectionAfterClose(
            previousSelections,
            removedSelections[0],
            previousActive,
            getClusterTabOrder()
          );
          if (nextAfterClose && normalizedSelections.includes(nextAfterClose)) {
            return nextAfterClose;
          }
        }
        return normalizedSelections[0] || '';
      }

      if (previousActive && normalizedSelections.includes(previousActive)) {
        return previousActive;
      }
      return normalizedSelections[0] || '';
    },
    []
  );

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
      const wasEmpty = previousSelections.length === 0;
      const willBeEmpty = normalizedSelections.length === 0;
      const selectionChanged =
        normalizedSelections.length !== previousSelections.length ||
        normalizedSelections.some((selection, index) => selection !== previousSelections[index]);
      const shouldEmitChanging = selectionChanged && willBeEmpty;
      const shouldEmitChanged = !willBeEmpty && wasEmpty;
      const shouldEmitSelectionChanged = selectionChanged && !willBeEmpty;
      const nextMeta = resolveClusterMeta(nextActive, kubeconfigsRef.current);

      try {
        // Any selection-set mutation supersedes an in-flight tab-only activation.
        latestForegroundActivationRequestIdRef.current += 1;
        selectionPendingRef.current = true;
        // Keep refs in sync immediately so superseding requests read the latest state.
        selectedKubeconfigsRef.current = normalizedSelections;
        selectedKubeconfigRef.current = nextActive;

        // Optimistically update the UI immediately so the dropdown reflects the intent.
        setSelectedKubeconfigsState(normalizedSelections);
        setSelectedKubeconfigState(nextActive);

        // Follow the required order while keeping per-tab state intact.
        // 1. Show the loading spinner (handled by kubeconfig:changing event)
        // 2. Cancel any refresh in progress (also handled by kubeconfig:changing event)
        if (shouldEmitChanging) {
          eventBus.emit('kubeconfig:changing', '');
        }

        // Perform the actual kubeconfig switch.
        await SetSelectedKubeconfigs(normalizedSelections);

        // A newer intent has already been issued; ignore stale completion.
        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }

        // SetSelectedKubeconfigs makes the cluster open; SetVisibleCluster then
        // completes any governor re-warm before its identity reaches data consumers.
        if (nextMeta.id) {
          await SetVisibleCluster(nextMeta.id);
        }

        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }

        // Emit after backend updates to avoid refreshing with inactive clusters.
        if (shouldEmitSelectionChanged) {
          eventBus.emit('kubeconfig:selection-changed');
        }
        selectionPendingRef.current = false;
        // Publish cluster-data identities only after the backend activates the
        // matching client pool and refresh subsystems.
        committedSelectionsRef.current = normalizedSelections;
        committedActiveRef.current = nextActive;
        setCommittedSelectedKubeconfigs(normalizedSelections);
        setCommittedSelectedKubeconfig(nextActive);

        // 4. Perform a manual refresh (will be triggered by kubeconfig:changed event).
        if (shouldEmitChanged) {
          eventBus.emit('kubeconfig:changed', '');
        }
      } catch (error) {
        // Ignore stale errors from superseded requests.
        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }
        selectionPendingRef.current = false;
        // Roll back to the last committed backend selection.
        let rollbackSelections = committedSelectionsRef.current;
        let rollbackActive = committedActiveRef.current;
        try {
          const confirmed = normalizeSelections(
            (await requestAppState({
              resource: 'selected-kubeconfigs',
              read: () => readSelectedKubeconfigs(),
            })) || []
          );
          rollbackSelections = confirmed;
          rollbackActive =
            rollbackActive && confirmed.includes(rollbackActive)
              ? rollbackActive
              : confirmed[0] || '';
        } catch {
          // Keep last committed in-memory snapshot when backend confirmation fails.
        }
        committedSelectionsRef.current = rollbackSelections;
        committedActiveRef.current = rollbackActive;
        selectedKubeconfigsRef.current = rollbackSelections;
        selectedKubeconfigRef.current = rollbackActive;
        setSelectedKubeconfigsState(rollbackSelections);
        setSelectedKubeconfigState(rollbackActive);
        setCommittedSelectedKubeconfigs(rollbackSelections);
        setCommittedSelectedKubeconfig(rollbackActive);
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
    [normalizeSelections, resolveClusterMeta, resolveNextActiveSelection]
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
        const activationRequestId = latestForegroundActivationRequestIdRef.current + 1;
        latestForegroundActivationRequestIdRef.current = activationRequestId;
        const meta = resolveClusterMeta(config, kubeconfigsRef.current);
        void (async () => {
          if (meta.id) {
            try {
              // A Cold cluster is rebuilt by this call. Do not expose its identity
              // to refresh consumers until the backend has finished re-warming it.
              await SetVisibleCluster(meta.id);
            } catch {
              // The backend method has no application-level error result. If the
              // binding itself is temporarily unavailable, restore the committed
              // tab and data identity instead of leaving the UI split across clusters.
              if (
                activationRequestId === latestForegroundActivationRequestIdRef.current &&
                selectedKubeconfigRef.current === config
              ) {
                selectedKubeconfigRef.current = committedActiveRef.current;
                setSelectedKubeconfigState(committedActiveRef.current);
              }
              return;
            }
          }
          if (
            activationRequestId !== latestForegroundActivationRequestIdRef.current ||
            selectedKubeconfigRef.current !== config ||
            !committedSelectionsRef.current.includes(config)
          ) {
            return;
          }
          committedActiveRef.current = config;
          setCommittedSelectedKubeconfig(config);
        })();
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
    const cancel = EventsOn('kubeconfig:available-changed', () => {
      void loadKubeconfigs();
    });

    return () => {
      if (typeof cancel === 'function') {
        cancel();
      }
    };
  }, [loadKubeconfigs]);

  // Bridge the backend's namespace-scope rebuild completion to the internal
  // event bus (docs/plans/namespace-scope.md): the orchestrator restarts the
  // cluster's streams and NamespaceContext refetches the namespaces list.
  useEffect(() => {
    const cancel = EventsOn('cluster:scope:changed', (payload?: { clusterId?: string }) => {
      logAppLogsInfo(
        `namespace-scope: cluster:scope:changed received for "${payload?.clusterId ?? ''}"`
      );
      eventBus.emit('cluster:scope-changed', { clusterId: payload?.clusterId ?? '' });
    });

    return () => {
      if (typeof cancel === 'function') {
        cancel();
      }
    };
  }, []);

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
      selectedKubeconfigs,
      selectedKubeconfig,
      // Kubeconfig strings drive the optimistic tab chrome. Cluster-data identity
      // stays on the backend-confirmed foreground/open set so a tab click cannot
      // race reads against a governor re-warm or a selection mutation.
      selectedClusterId: committedSelectedClusterMeta.id,
      selectedClusterName: committedSelectedClusterMeta.name,
      selectedClusterIds: committedSelectedClusterIds,
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
      selectedKubeconfigs,
      selectedKubeconfig,
      committedSelectedClusterMeta.id,
      committedSelectedClusterMeta.name,
      committedSelectedClusterIds,
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
