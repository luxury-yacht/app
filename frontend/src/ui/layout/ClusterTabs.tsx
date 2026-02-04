/**
 * frontend/src/ui/layout/ClusterTabs.tsx
 *
 * Cluster tab strip for multi-cluster navigation.
 */
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  getClusterTabOrder,
  hydrateClusterTabOrder,
  setClusterTabOrder,
  subscribeClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import { GetClusterPortForwardCount, StopClusterPortForwards } from '@wailsjs/go/backend/App';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import './ClusterTabs.css';

const ordersMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const moveTab = (order: string[], sourceId: string, targetId: string) => {
  const fromIndex = order.indexOf(sourceId);
  const toIndex = order.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return order;
  }
  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, sourceId);
  return next;
};

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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
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

    // Close the tab.
    const nextSelections = selectedKubeconfigs.filter(
      (config) => config !== closeConfirm.clusterId
    );
    void setSelectedKubeconfigs(nextSelections);

    // Reset confirmation state.
    setCloseConfirm({ show: false, clusterId: null, clusterLabel: '', forwardCount: 0 });
  }, [closeConfirm.clusterId, selectedKubeconfigs, setSelectedKubeconfigs]);

  const handleDrop = useCallback(
    (targetId: string) => {
      if (!draggingId) {
        setDropTargetId(null);
        return;
      }
      if (draggingId === targetId) {
        setDraggingId(null);
        setDropTargetId(null);
        return;
      }
      const nextOrder = moveTab(mergedOrder, draggingId, targetId);
      if (!ordersMatch(nextOrder, mergedOrder)) {
        setClusterTabOrder(nextOrder);
      }
      setDraggingId(null);
      setDropTargetId(null);
    },
    [draggingId, mergedOrder]
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

  return (
    <>
      <div ref={tabsRef} className="cluster-tabs" role="tablist" aria-label="Cluster tabs">
        {orderedTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDragging = tab.id === draggingId;
          const isDropTarget = tab.id === dropTargetId && tab.id !== draggingId;
          return (
            <div
              key={tab.id}
              className={`cluster-tab${isActive ? ' cluster-tab--active' : ''}${isDragging ? ' cluster-tab--dragging' : ''}${isDropTarget ? ' cluster-tab--drop-target' : ''}`}
              onDragOver={(event) => {
                if (!draggingId) {
                  return;
                }
                event.preventDefault();
                setDropTargetId(tab.id);
              }}
              onDragLeave={() => {
                setDropTargetId((current) => (current === tab.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(tab.id);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="cluster-tab__button"
                onClick={() => handleTabClick(tab.selection)}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', tab.id);
                  setDraggingId(tab.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTargetId(null);
                }}
              >
                <span className="cluster-tab__label" title={tab.label}>
                  {tab.label}
                </span>
              </button>
              <button
                type="button"
                className="cluster-tab__close"
                onClick={(event) => {
                  event.stopPropagation();
                  handleCloseTab(tab.selection);
                }}
                aria-label={`Close ${tab.label}`}
                title={`Close ${tab.label}`}
              >
                x
              </button>
            </div>
          );
        })}
      </div>
      <ConfirmationModal
        isOpen={closeConfirm.show}
        title="Active Port Forwards"
        message={`Cluster "${closeConfirm.clusterLabel}" has ${closeConfirm.forwardCount} active port forward${closeConfirm.forwardCount > 1 ? 's' : ''}. Stop ${closeConfirm.forwardCount > 1 ? 'them' : 'it'} and close?`}
        confirmText="Stop & Close"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={handleConfirmClose}
        onCancel={() => setCloseConfirm({ show: false, clusterId: null, clusterLabel: '', forwardCount: 0 })}
      />
    </>
  );
};

export default React.memo(ClusterTabs);
