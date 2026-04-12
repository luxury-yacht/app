/**
 * frontend/src/ui/layout/ClusterTabs.tsx
 *
 * Cluster tab strip for multi-cluster navigation.
 */
import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  type HTMLAttributes,
} from 'react';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  getClusterTabOrder,
  hydrateClusterTabOrder,
  setClusterTabOrder,
  subscribeClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import {
  GetClusterPortForwardCount,
  StopClusterPortForwards,
  StopClusterShellSessions,
} from '@wailsjs/go/backend/App';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import { Tabs, type TabDescriptor } from '@shared/components/tabs';
import { useTabDragSourceFactory, useTabDropTarget } from '@shared/components/tabs/dragCoordinator';
import './ClusterTabs.css';

const ordersMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

type ClusterTab = {
  id: string;
  label: string;
  selection: string;
};

const ClusterTabs: React.FC = () => {
  const {
    selectedKubeconfigs,
    selectedKubeconfig,
    setSelectedKubeconfigs,
    setActiveKubeconfig,
    getClusterMeta,
  } = useKubeconfig();
  const [tabOrder, setTabOrder] = useState<string[]>(() => getClusterTabOrder());
  const tabsRef = useRef<HTMLDivElement | null>(null);
  // State for cluster close confirmation modal when port forwards are active.
  const [closeConfirm, setCloseConfirm] = useState<{
    show: boolean;
    clusterId: string | null;
    clusterLabel: string;
    forwardCount: number;
  }>({ show: false, clusterId: null, clusterLabel: '', forwardCount: 0 });

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      const order = await hydrateClusterTabOrder();
      if (active) {
        setTabOrder(order);
      }
    };
    void hydrate();
    const unsubscribe = subscribeClusterTabOrder((order) => {
      setTabOrder(order);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const tabs = useMemo<ClusterTab[]>(() => {
    // Count occurrences of each context name to detect collisions.
    const nameCounts = new Map<string, number>();
    selectedKubeconfigs.forEach((selection) => {
      const meta = getClusterMeta(selection);
      const name = meta.name || '';
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    });

    return selectedKubeconfigs.map((selection) => {
      const meta = getClusterMeta(selection);
      // Use filename:context format when there are name collisions.
      const hasCollision = (nameCounts.get(meta.name || '') || 0) > 1;
      const label = hasCollision ? meta.id || selection : meta.name || selection;
      return { id: selection, label, selection };
    });
  }, [getClusterMeta, selectedKubeconfigs]);

  const selectionOrderIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

  const mergedOrder = useMemo(() => {
    // Prefer persisted drag order, then append any newly opened tabs by selection order.
    const persisted = tabOrder.filter((id) => selectionOrderIds.includes(id));
    const missing = selectionOrderIds.filter((id) => !persisted.includes(id));
    return [...persisted, ...missing];
  }, [selectionOrderIds, tabOrder]);

  useEffect(() => {
    if (ordersMatch(mergedOrder, tabOrder)) {
      return;
    }
    setClusterTabOrder(mergedOrder);
  }, [mergedOrder, tabOrder]);

  const tabsById = useMemo(() => {
    const map = new Map<string, ClusterTab>();
    tabs.forEach((tab) => map.set(tab.id, tab));
    return map;
  }, [tabs]);

  const orderedTabs = useMemo(() => {
    return mergedOrder
      .map((id) => tabsById.get(id))
      .filter((tab): tab is ClusterTab => Boolean(tab));
  }, [mergedOrder, tabsById]);

  const activeTabId = useMemo(() => {
    return tabs.find((tab) => tab.selection === selectedKubeconfig)?.id ?? null;
  }, [selectedKubeconfig, tabs]);

  const handleTabClick = useCallback(
    (selection: string) => {
      setActiveKubeconfig(selection);
    },
    [setActiveKubeconfig]
  );

  // Handles closing a cluster tab. Checks for active port forwards first and
  // prompts for confirmation if any are found.
  const handleCloseTab = useCallback(
    async (selection: string) => {
      // Find the tab label for the cluster being closed.
      const tab = tabs.find((t) => t.selection === selection);
      const label = tab?.label ?? selection;

      // Check if there are active port forwards for this cluster.
      try {
        const count = await GetClusterPortForwardCount(selection);
        if (count > 0) {
          // Show confirmation modal with the count.
          setCloseConfirm({
            show: true,
            clusterId: selection,
            clusterLabel: label,
            forwardCount: count,
          });
          return;
        }
      } catch (err) {
        console.warn('Failed to check cluster port forward count:', err);
      }

      // Stop tracked shell sessions for this cluster before closing.
      try {
        await StopClusterShellSessions(selection);
      } catch (err) {
        console.warn('Failed to stop cluster shell sessions:', err);
      }

      // No active port forwards, proceed directly with closing.
      const nextSelections = selectedKubeconfigs.filter((config) => config !== selection);
      void setSelectedKubeconfigs(nextSelections);
    },
    [selectedKubeconfigs, setSelectedKubeconfigs, tabs]
  );

  // Handles confirmed close when user accepts stopping port forwards.
  const handleConfirmClose = useCallback(async () => {
    if (!closeConfirm.clusterId) return;

    // Stop all port forwards for this cluster.
    try {
      await StopClusterPortForwards(closeConfirm.clusterId);
    } catch (err) {
      console.warn('Failed to stop cluster port forwards:', err);
    }
    try {
      await StopClusterShellSessions(closeConfirm.clusterId);
    } catch (err) {
      console.warn('Failed to stop cluster shell sessions:', err);
    }

    // Close the tab.
    const nextSelections = selectedKubeconfigs.filter(
      (config) => config !== closeConfirm.clusterId
    );
    void setSelectedKubeconfigs(nextSelections);

    // Reset confirmation state.
    setCloseConfirm({ show: false, clusterId: null, clusterLabel: '', forwardCount: 0 });
  }, [closeConfirm.clusterId, selectedKubeconfigs, setSelectedKubeconfigs]);

  // One useContext call for the entire drag coordinator, regardless of how
  // many tabs are rendered. Returned factory is a plain function legal inside
  // .map() — no rules-of-hooks workaround and no upper bound on draggable tab
  // count.
  const makeDragSource = useTabDragSourceFactory();

  const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
    accepts: ['cluster-tab'],
    onDrop: (payload, _event, insertIndex) => {
      // Reorder directly against insertIndex. DO NOT reuse the legacy
      // moveTab helper — it splices at the target's ORIGINAL index in the
      // reduced array, which produces off-by-one for forward drags.
      //
      // Shift compensation: when source is before the insert index, removing
      // it bumps every later position down by 1, so the effective destination
      // is insertIndex - 1. When source is at or after the insert index, no
      // shift is needed.
      const sourceIdx = mergedOrder.indexOf(payload.clusterId);
      if (sourceIdx < 0) return;
      const adjustedInsert = sourceIdx < insertIndex ? insertIndex - 1 : insertIndex;
      if (adjustedInsert === sourceIdx) return; // no-op drop onto itself
      const nextOrder = [...mergedOrder];
      nextOrder.splice(sourceIdx, 1);
      nextOrder.splice(adjustedInsert, 0, payload.clusterId);
      if (!ordersMatch(nextOrder, mergedOrder)) {
        setClusterTabOrder(nextOrder);
      }
    },
  });

  // Compose the tabsRef + dropRef into a single ref callback so both the
  // height observer and the drop target see the same element.
  // IMPORTANT: this useCallback must be declared before the early-return
  // conditional to satisfy the rules of hooks.
  const assignRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      tabsRef.current = el;
      dropRef(el);
    },
    [dropRef]
  );

  useEffect(() => {
    // Expose the tab strip height so dockable panels can respect the top chrome.
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    if (orderedTabs.length < 2) {
      root.style.setProperty('--cluster-tabs-height', '0px');
      return;
    }
    const updateHeight = () => {
      const height = tabsRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty('--cluster-tabs-height', `${Math.round(height)}px`);
    };

    updateHeight();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && tabsRef.current) {
      observer = new ResizeObserver(() => updateHeight());
      observer.observe(tabsRef.current);
    }

    return () => {
      observer?.disconnect();
      root.style.setProperty('--cluster-tabs-height', '0px');
    };
  }, [orderedTabs.length]);

  if (orderedTabs.length < 2) {
    return null;
  }

  // Note: `makeDragSource` produces a fresh closure every call (by design —
  // one call per tab per render). Do NOT wrap this .map() in useMemo with
  // `makeDragSource` as a dep: the factory has new identity each render and
  // would bust the memo every time. Per-render allocation is fine here.
  const tabDescriptors: TabDescriptor[] = orderedTabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    closeIcon: <CloseIcon width={10} height={10} />,
    closeAriaLabel: `Close ${tab.label}`,
    onClose: () => {
      void handleCloseTab(tab.selection);
    },
    extraProps: {
      title: tab.label, // tooltip for full text when truncated
      ...makeDragSource({ kind: 'cluster-tab', clusterId: tab.id }),
    } as HTMLAttributes<HTMLElement>,
  }));

  return (
    <>
      <div ref={assignRootRef} className="cluster-tabs-wrapper">
        <Tabs
          aria-label="Cluster Tabs"
          tabs={tabDescriptors}
          activeId={activeTabId}
          onActivate={(id) => {
            const tab = tabsById.get(id);
            if (tab) handleTabClick(tab.selection);
          }}
          dropInsertIndex={dropInsertIndex}
          className="cluster-tabs"
        />
      </div>
      <ConfirmationModal
        isOpen={closeConfirm.show}
        title="Active Port Forwards"
        message={`Cluster "${closeConfirm.clusterLabel}" has ${closeConfirm.forwardCount} active port forward${closeConfirm.forwardCount > 1 ? 's' : ''}. Stop ${closeConfirm.forwardCount > 1 ? 'them' : 'it'} and close?`}
        confirmText="Stop & Close"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={handleConfirmClose}
        onCancel={() =>
          setCloseConfirm({ show: false, clusterId: null, clusterLabel: '', forwardCount: 0 })
        }
      />
    </>
  );
};

export default React.memo(ClusterTabs);
