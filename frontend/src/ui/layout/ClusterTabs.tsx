import { getWindowIdentity } from '@/core/desktop-runtime';
import { requestClusterTabTransfer } from '@/core/panel-windows';
import { ClusterPanelsMenu } from '@/core/panel-windows/ClusterPanelsMenu';
import { reportOperationalError } from '@/utils/errorHandler';
/**
 * frontend/src/ui/layout/ClusterTabs.tsx
 *
 * Cluster tab strip for multi-cluster navigation.
 */

import { useViewState } from '@core/contexts/ViewStateContext';
import {
  getClusterTabOrder,
  hydrateClusterTabOrder,
  mergeClusterTabOrder,
  setClusterTabOrder,
  subscribeClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { CloseIcon, PlusIcon } from '@shared/components/icons/SharedIcons';
import { type TabDescriptor, Tabs } from '@shared/components/tabs';
import { useTabDragSourceFactory, useTabDropTarget } from '@shared/components/tabs/dragCoordinator';
import { tabReorderMenuItems } from '@shared/components/tabs/tabReorderMenuItems';
import React, {
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getClusterSelectionPhase } from './clusterSelectionPhase';
import './ClusterTabs.css';

const ordersMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const toClusterInsertIndex = (tabInsertIndex: number, hasGlobalTab: boolean): number =>
  Math.max(0, tabInsertIndex - (hasGlobalTab ? 1 : 0));

type ClusterTab = {
  id: string;
  label: string;
  selection: string;
};

interface ClusterTabsProps {
  /** Opens the Open Cluster modal. Wired from AppLayout. */
  onOpenCluster?: () => void;
}

const ClusterTabs: React.FC<ClusterTabsProps> = ({ onOpenCluster }) => {
  const windowName = getWindowIdentity();
  const { viewType, navigateToGlobal, activateClusterWorkspace } = useViewState();
  const {
    selectedKubeconfigs,
    selectedKubeconfig,
    kubeconfigsLoading,
    setActiveKubeconfig,
    getClusterMeta,
    closeKubeconfig,
  } = useKubeconfig();
  const [panelMenu, setPanelMenu] = useState<{
    clusterId: string;
    selection: string;
    position: { x: number; y: number };
  } | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>(() => getClusterTabOrder());
  const [tabOrderHydrated, setTabOrderHydrated] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const clusterSelectionPhase = getClusterSelectionPhase({
    hasSelectedClusters: selectedKubeconfigs.length > 0,
    kubeconfigsLoading,
  });

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const order = await hydrateClusterTabOrder();
        if (active) {
          setTabOrder(order);
        }
      } finally {
        if (active) {
          setTabOrderHydrated(true);
        }
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
    return mergeClusterTabOrder(selectionOrderIds, tabOrder);
  }, [selectionOrderIds, tabOrder]);

  useEffect(() => {
    if (panelMenu && !mergedOrder.includes(panelMenu.selection)) {
      setPanelMenu(null);
    }
  }, [mergedOrder, panelMenu]);

  useEffect(() => {
    if (kubeconfigsLoading || !tabOrderHydrated) {
      return;
    }
    if (ordersMatch(mergedOrder, tabOrder)) {
      return;
    }
    setClusterTabOrder(mergedOrder);
  }, [kubeconfigsLoading, mergedOrder, tabOrder, tabOrderHydrated]);

  const tabsById = useMemo(() => {
    const map = new Map<string, ClusterTab>();
    tabs.forEach((tab) => {
      map.set(tab.id, tab);
    });
    return map;
  }, [tabs]);

  const orderedTabs = useMemo(() => {
    return mergedOrder
      .map((id) => tabsById.get(id))
      .filter((tab): tab is ClusterTab => Boolean(tab));
  }, [mergedOrder, tabsById]);

  const activeTabId = useMemo(() => {
    if (viewType === 'global') {
      return '__global__';
    }
    return tabs.find((tab) => tab.selection === selectedKubeconfig)?.id ?? null;
  }, [selectedKubeconfig, tabs, viewType]);

  const handleTabClick = useCallback(
    (selection: string) => {
      const clusterId = getClusterMeta(selection).id;
      activateClusterWorkspace(clusterId);
      setActiveKubeconfig(selection);
    },
    [activateClusterWorkspace, getClusterMeta, setActiveKubeconfig]
  );

  const closeClusterSelection = useCallback(
    (selection: string) => {
      void closeKubeconfig(selection).catch((err) => {
        console.warn('Failed to close cluster:', err);
      });
    },
    [closeKubeconfig]
  );

  // One useContext call for the entire drag coordinator, regardless of how
  // many tabs are rendered. Returned factory is a plain function legal inside
  // .map() — no rules-of-hooks workaround and no upper bound on draggable tab
  // count.
  const makeDragSource = useTabDragSourceFactory();

  const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
    accepts: ['cluster-tab'],
    allowExternal: true,
    onDrop: (payload, _event, insertIndex) => {
      // Reorder directly against insertIndex. DO NOT reuse the legacy
      // moveTab helper — it splices at the target's ORIGINAL index in the
      // reduced array, which produces off-by-one for forward drags.
      //
      // Shift compensation: when source is before the insert index, removing
      // it bumps every later position down by 1, so the effective destination
      // is insertIndex - 1. When source is at or after the insert index, no
      // shift is needed.
      const clusterInsertIndex = toClusterInsertIndex(insertIndex, orderedTabs.length > 1);
      if (payload.sourceWindowName !== windowName) {
        void requestClusterTabTransfer(windowName, {
          transferId: globalThis.crypto.randomUUID(),
          sourceWindowName: payload.sourceWindowName,
          targetWindowName: windowName,
          clusterId: payload.clusterId,
          targetIndex: clusterInsertIndex,
        }).catch((error) =>
          reportOperationalError(error, {
            source: 'ClusterTabs',
            action: 'move-cluster-tab',
            clusterId: payload.clusterId,
          })
        );
        return;
      }
      const sourceIdx = mergedOrder.indexOf(payload.selection);
      if (sourceIdx < 0) {
        return;
      }
      const adjustedInsert =
        sourceIdx < clusterInsertIndex ? clusterInsertIndex - 1 : clusterInsertIndex;
      if (adjustedInsert === sourceIdx) {
        return; // no-op drop onto itself
      }
      const nextOrder = [...mergedOrder];
      nextOrder.splice(sourceIdx, 1);
      nextOrder.splice(adjustedInsert, 0, payload.selection);
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
    void orderedTabs.length;
    // Expose the tab strip height so dockable panels can respect the top chrome.
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
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

  // Note: `makeDragSource` produces a fresh closure every call (by design —
  // one call per tab per render). Do NOT wrap this .map() in useMemo with
  // `makeDragSource` as a dep: the factory has new identity each render and
  // would bust the memo every time. Per-render allocation is fine here.
  const clusterTabDescriptors: TabDescriptor[] = orderedTabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    closeIcon: <CloseIcon width={10} height={10} />,
    closeAriaLabel: `Close ${tab.label}`,
    onClose: () => {
      closeClusterSelection(tab.selection);
    },
    extraProps: {
      title: tab.label,
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        setPanelMenu({
          clusterId: getClusterMeta(tab.selection).id,
          selection: tab.selection,
          position: { x: event.clientX, y: event.clientY },
        });
      },
      ...makeDragSource({
        kind: 'cluster-tab',
        clusterId: getClusterMeta(tab.selection).id,
        selection: tab.selection,
        sourceWindowName: windowName,
      }),
    } as HTMLAttributes<HTMLElement>,
  }));
  const tabDescriptors: TabDescriptor[] =
    orderedTabs.length > 1
      ? [{ id: '__global__', label: 'Global' }, ...clusterTabDescriptors]
      : clusterTabDescriptors;

  return (
    <div ref={assignRootRef} className="cluster-tabs-wrapper" data-app-region="header">
      {panelMenu ? (
        <ClusterPanelsMenu
          clusterId={panelMenu.clusterId}
          position={panelMenu.position}
          onClose={() => setPanelMenu(null)}
          onCloseCluster={() => closeClusterSelection(panelMenu.selection)}
          orderActions={tabReorderMenuItems(mergedOrder, panelMenu.selection, (index) => {
            const next = mergedOrder.filter((id) => id !== panelMenu.selection);
            next.splice(index, 0, panelMenu.selection);
            setClusterTabOrder(next);
          })}
        />
      ) : null}
      {orderedTabs.length > 0 && (
        <Tabs
          aria-label="Cluster Tabs"
          tabNavigation="sequential"
          tabs={tabDescriptors}
          activeId={activeTabId}
          onActivate={(id) => {
            if (id === '__global__') {
              navigateToGlobal();
              return;
            }
            const tab = tabsById.get(id);
            if (tab) {
              handleTabClick(tab.selection);
            }
          }}
          dropInsertIndex={dropInsertIndex}
          className="cluster-tabs"
        />
      )}
      {/* Keep the button beside the tabs and outside their scroll container. */}
      {clusterSelectionPhase !== 'pending' && (
        <button
          type="button"
          className="cluster-tabs-add"
          title="Open Cluster"
          aria-label="Open Cluster"
          onClick={() => onOpenCluster?.()}
        >
          {orderedTabs.length === 0 && (
            <span className="cluster-tabs-add__label">Open Cluster</span>
          )}
          <PlusIcon width={14} height={14} />
        </button>
      )}
    </div>
  );
};

export default React.memo(ClusterTabs);
