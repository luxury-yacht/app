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
import React, {
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  const { viewType, navigateToGlobal, activateClusterWorkspace } = useViewState();
  const {
    selectedKubeconfigs,
    selectedKubeconfig,
    setActiveKubeconfig,
    getClusterMeta,
    closeKubeconfig,
  } = useKubeconfig();
  const [tabOrder, setTabOrder] = useState<string[]>(() => getClusterTabOrder());
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const fullAddWidthRef = useRef(140);
  const showAddLabelRef = useRef(true);
  const [showAddLabel, setShowAddLabel] = useState(true);

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
    return mergeClusterTabOrder(selectionOrderIds, tabOrder);
  }, [selectionOrderIds, tabOrder]);

  useEffect(() => {
    if (ordersMatch(mergedOrder, tabOrder)) {
      return;
    }
    setClusterTabOrder(mergedOrder);
  }, [mergedOrder, tabOrder]);

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
      const sourceIdx = mergedOrder.indexOf(payload.clusterId);
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

  useEffect(() => {
    void orderedTabs.length;
    // Show "Open Cluster" beside the "+" while the bar has room; collapse to just
    // "+" when the tabs need the space. The test compares the tabs' full content
    // width to the wrapper minus the EXPANDED button width, so it doesn't
    // flip-flop when toggling the label itself changes the layout.
    const wrapper = tabsRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') {
      return;
    }
    const strip = wrapper.querySelector<HTMLElement>('.cluster-tabs');

    const measure = () => {
      // Skip before layout (also keeps the label expanded in non-layout tests).
      if (!wrapper.clientWidth) {
        return;
      }
      if (showAddLabelRef.current && addBtnRef.current) {
        fullAddWidthRef.current = addBtnRef.current.offsetWidth;
      }
      // Sum the tab widths directly. scrollWidth only reports the intrinsic
      // content width while the strip OVERFLOWS; once the tabs fit it equals the
      // strip's own (wide) width, which would wedge the label collapsed after the
      // window is widened.
      let tabsContentWidth = 0;
      strip?.querySelectorAll<HTMLElement>('.tab-item').forEach((el) => {
        tabsContentWidth += el.offsetWidth;
      });
      const next = tabsContentWidth + fullAddWidthRef.current <= wrapper.clientWidth;
      if (next !== showAddLabelRef.current) {
        showAddLabelRef.current = next;
        setShowAddLabel(next);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    if (strip) {
      observer.observe(strip);
    }
    return () => observer.disconnect();
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
      title: tab.label, // tooltip for full text when truncated
      ...makeDragSource({ kind: 'cluster-tab', clusterId: tab.id }),
    } as HTMLAttributes<HTMLElement>,
  }));
  const tabDescriptors: TabDescriptor[] =
    orderedTabs.length > 1
      ? [{ id: '__global__', label: 'Global' }, ...clusterTabDescriptors]
      : clusterTabDescriptors;

  return (
    <div ref={assignRootRef} className="cluster-tabs-wrapper">
      {orderedTabs.length > 0 && (
        <Tabs
          aria-label="Cluster Tabs"
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
      {/* Pinned to the right, outside the scrolling <Tabs> strip, so it can never
          scroll off. It is also the sole affordance when no clusters are open. */}
      <button
        ref={addBtnRef}
        type="button"
        className="cluster-tabs-add"
        title="Open Cluster"
        aria-label="Open Cluster"
        onClick={() => onOpenCluster?.()}
      >
        {!!showAddLabel && <span className="cluster-tabs-add__label">Open Cluster</span>}
        <PlusIcon width={14} height={14} />
      </button>
    </div>
  );
};

export default React.memo(ClusterTabs);
