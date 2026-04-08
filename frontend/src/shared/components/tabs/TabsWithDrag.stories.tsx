/**
 * frontend/src/shared/components/tabs/TabsWithDrag.stories.tsx
 *
 * Storybook stories for the tab drag coordinator. Each story wraps the
 * shared <Tabs> component in a <TabDragProvider> and uses
 * useTabDragSource / useTabDropTarget to demonstrate a drag scenario.
 *
 * Hooks-rules note: React forbids calling hooks inside loops or callbacks,
 * so useTabDragSource cannot be invoked from inside `.map()`. Each wrapper
 * below unrolls the hook calls to the top level of its component body for
 * a fixed number of tabs (all scenarios use <= 5 tabs). This is mildly
 * repetitive but fully compliant with the rules of hooks.
 */

import { useCallback, useRef, useState, type CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { Tabs, type TabDescriptor } from './Tabs';
import { TabDragProvider, useTabDragSource, useTabDropTarget } from './dragCoordinator';
import type { TabDragPayload } from './dragCoordinator';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';

// Lightweight action logger — mirrors Tabs.stories.tsx since the project
// does not install @storybook/addon-actions. Console output is still
// visible in the browser devtools while clicking around stories.
const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[TabsWithDrag story] ${name}`, ...args);
  };

/**
 * Given a horizontal drop event and a list of tab button elements, return
 * the index the dragged tab should be inserted at. Uses each button's
 * midpoint: cursor left-of-midpoint inserts before that tab, right-of
 * inserts after. Tabs not present in the DOM (e.g. during initial render)
 * are skipped.
 */
function computeDropIndex(stripElement: HTMLElement, clientX: number): number {
  const buttons = Array.from(stripElement.querySelectorAll<HTMLElement>('[role="tab"]'));
  for (let i = 0; i < buttons.length; i += 1) {
    const rect = buttons[i].getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    if (clientX < midpoint) return i;
  }
  return buttons.length;
}

/** Reorder: move `fromId` to position `toIndex` in the tab list. */
function reorder(tabs: TabDescriptor[], fromId: string, toIndex: number): TabDescriptor[] {
  const fromIndex = tabs.findIndex((t) => t.id === fromId);
  if (fromIndex === -1) return tabs;
  const next = tabs.slice();
  const [moved] = next.splice(fromIndex, 1);
  // If the item was before the target index, removing it shifted everything.
  const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(adjusted, 0, moved);
  return next;
}

// ---------------------------------------------------------------------------
// Story 1: Within-strip reorder using cluster-tab payload
// ---------------------------------------------------------------------------

function ClusterReorderStrip() {
  const [tabs, setTabs] = useState<TabDescriptor[]>([
    { id: 'a', label: 'Cluster A' },
    { id: 'b', label: 'Cluster B' },
    { id: 'c', label: 'Cluster C' },
    { id: 'd', label: 'Cluster D' },
    { id: 'e', label: 'Cluster E' },
  ]);
  const [activeId, setActiveId] = useState<string | null>('a');

  // Unrolled hook calls — one per slot, bound to the CURRENT tab at that
  // slot so payloads stay in sync after reorders. Empty slots pass null,
  // which safely disables drag for that slot.
  const drag0 = useTabDragSource(tabs[0] ? { kind: 'cluster-tab', clusterId: tabs[0].id } : null);
  const drag1 = useTabDragSource(tabs[1] ? { kind: 'cluster-tab', clusterId: tabs[1].id } : null);
  const drag2 = useTabDragSource(tabs[2] ? { kind: 'cluster-tab', clusterId: tabs[2].id } : null);
  const drag3 = useTabDragSource(tabs[3] ? { kind: 'cluster-tab', clusterId: tabs[3].id } : null);
  const drag4 = useTabDragSource(tabs[4] ? { kind: 'cluster-tab', clusterId: tabs[4].id } : null);
  const dragProps = [drag0, drag1, drag2, drag3, drag4];

  const stripRef = useRef<HTMLDivElement | null>(null);
  const { ref: dropRef, isDragOver } = useTabDropTarget({
    accepts: ['cluster-tab'],
    onDrop: (payload, event) => {
      logAction('onDrop[cluster]')(payload);
      const strip = stripRef.current;
      if (!strip) return;
      const toIndex = computeDropIndex(strip, event.clientX);
      setTabs((prev) => reorder(prev, payload.clusterId, toIndex));
    },
  });

  // Compose a ref that assigns to both the local stripRef and the drop target.
  const assignRef = (el: HTMLDivElement | null) => {
    stripRef.current = el;
    dropRef(el);
  };

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={assignRef}
      style={{ outline: isDragOver ? '2px dashed #3b82f6' : 'none', padding: 4 }}
    >
      <Tabs
        aria-label="Cluster Drag Demo Tabs"
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate[cluster]')(id);
          setActiveId(id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story 2: Within-strip reorder using dockable-tab payload + custom drag image
// ---------------------------------------------------------------------------

function DockableReorderStrip() {
  const [tabs, setTabs] = useState<TabDescriptor[]>([
    { id: 'a', label: 'Panel A' },
    { id: 'b', label: 'Panel B' },
    { id: 'c', label: 'Panel C' },
    { id: 'd', label: 'Panel D' },
    { id: 'e', label: 'Panel E' },
  ]);
  const [activeId, setActiveId] = useState<string | null>('a');

  const previewRef = useRef<HTMLDivElement | null>(null);

  // Unrolled hook calls with per-slot getDragImage. Each slot binds to the
  // CURRENT tab at that index so payloads and drag images stay in sync
  // after reorders. Empty slots pass null to disable drag.
  const drag0 = useTabDragSource(
    tabs[0] ? { kind: 'dockable-tab', panelId: tabs[0].id, sourceGroupId: 'main' } : null,
    {
      getDragImage: () => {
        if (!previewRef.current || !tabs[0]) return null;
        previewRef.current.textContent = String(tabs[0].label);
        return { element: previewRef.current, offsetX: 14, offsetY: 16 };
      },
    }
  );
  const drag1 = useTabDragSource(
    tabs[1] ? { kind: 'dockable-tab', panelId: tabs[1].id, sourceGroupId: 'main' } : null,
    {
      getDragImage: () => {
        if (!previewRef.current || !tabs[1]) return null;
        previewRef.current.textContent = String(tabs[1].label);
        return { element: previewRef.current, offsetX: 14, offsetY: 16 };
      },
    }
  );
  const drag2 = useTabDragSource(
    tabs[2] ? { kind: 'dockable-tab', panelId: tabs[2].id, sourceGroupId: 'main' } : null,
    {
      getDragImage: () => {
        if (!previewRef.current || !tabs[2]) return null;
        previewRef.current.textContent = String(tabs[2].label);
        return { element: previewRef.current, offsetX: 14, offsetY: 16 };
      },
    }
  );
  const drag3 = useTabDragSource(
    tabs[3] ? { kind: 'dockable-tab', panelId: tabs[3].id, sourceGroupId: 'main' } : null,
    {
      getDragImage: () => {
        if (!previewRef.current || !tabs[3]) return null;
        previewRef.current.textContent = String(tabs[3].label);
        return { element: previewRef.current, offsetX: 14, offsetY: 16 };
      },
    }
  );
  const drag4 = useTabDragSource(
    tabs[4] ? { kind: 'dockable-tab', panelId: tabs[4].id, sourceGroupId: 'main' } : null,
    {
      getDragImage: () => {
        if (!previewRef.current || !tabs[4]) return null;
        previewRef.current.textContent = String(tabs[4].label);
        return { element: previewRef.current, offsetX: 14, offsetY: 16 };
      },
    }
  );
  const dragProps = [drag0, drag1, drag2, drag3, drag4];

  const stripRef = useRef<HTMLDivElement | null>(null);
  const { ref: dropRef, isDragOver } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => {
      logAction('onDrop[dockable]')(payload);
      const strip = stripRef.current;
      if (!strip) return;
      const toIndex = computeDropIndex(strip, event.clientX);
      setTabs((prev) => reorder(prev, payload.panelId, toIndex));
    },
  });

  const assignRef = (el: HTMLDivElement | null) => {
    stripRef.current = el;
    dropRef(el);
  };

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <>
      <div
        ref={assignRef}
        style={{ outline: isDragOver ? '2px dashed #3b82f6' : 'none', padding: 4 }}
      >
        <Tabs
          aria-label="Dockable Drag Demo Tabs"
          tabs={tabsWithDrag}
          activeId={activeId}
          onActivate={(id) => {
            logAction('onActivate[dockable]')(id);
            setActiveId(id);
          }}
        />
      </div>
      {/* Offscreen preview element — must be in the DOM when dragstart fires. */}
      <div
        ref={previewRef}
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          padding: '0.4rem 0.55rem',
          borderRadius: 6,
          border: '1px solid #3b82f6',
          background: '#1e293b',
          color: '#fff',
          fontSize: '0.74rem',
          whiteSpace: 'nowrap',
        }}
        aria-hidden="true"
      >
        Drag preview
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Story 3: Cross-strip drag using dockable-tab payload
// ---------------------------------------------------------------------------

/**
 * Single dockable strip wired up with its own drop target. Uses unrolled
 * hook calls for a fixed 4-tab count. The parent owns BOTH strips' state
 * so it can move tabs between them; we pass in the strip's current tabs
 * plus a single onMove callback that the parent uses to atomically update
 * both source and target state.
 */
interface CrossStripProps {
  label: string;
  groupId: 'left' | 'right';
  tabs: TabDescriptor[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onMove: (panelId: string, sourceGroupId: string, targetGroupId: string, toIndex: number) => void;
}

function CrossStrip({ label, groupId, tabs, activeId, onActivate, onMove }: CrossStripProps) {
  // Four fixed slots. Tabs may be undefined when the strip has fewer items.
  // useTabDragSource(null) safely disables the drag for empty slots.
  const slot0 = tabs[0];
  const slot1 = tabs[1];
  const slot2 = tabs[2];
  const slot3 = tabs[3];

  const drag0 = useTabDragSource(
    slot0 ? { kind: 'dockable-tab', panelId: slot0.id, sourceGroupId: groupId } : null
  );
  const drag1 = useTabDragSource(
    slot1 ? { kind: 'dockable-tab', panelId: slot1.id, sourceGroupId: groupId } : null
  );
  const drag2 = useTabDragSource(
    slot2 ? { kind: 'dockable-tab', panelId: slot2.id, sourceGroupId: groupId } : null
  );
  const drag3 = useTabDragSource(
    slot3 ? { kind: 'dockable-tab', panelId: slot3.id, sourceGroupId: groupId } : null
  );
  const dragProps = [drag0, drag1, drag2, drag3];

  const stripRef = useRef<HTMLDivElement | null>(null);
  const { ref: dropRef, isDragOver } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => {
      logAction(`onDrop[${groupId}]`)(payload);
      const strip = stripRef.current;
      if (!strip) return;
      const toIndex = computeDropIndex(strip, event.clientX);
      onMove(payload.panelId, payload.sourceGroupId, groupId, toIndex);
    },
  });

  const assignRef = (el: HTMLDivElement | null) => {
    stripRef.current = el;
    dropRef(el);
  };

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={assignRef}
      style={{
        flex: 1,
        outline: isDragOver ? '2px dashed #3b82f6' : '1px solid #334155',
        padding: 6,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>{label}</div>
      <Tabs
        aria-label={`${label} Tabs`}
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={onActivate}
      />
    </div>
  );
}

function CrossStripHarness() {
  const [leftTabs, setLeftTabs] = useState<TabDescriptor[]>([
    { id: 'l1', label: 'Left 1' },
    { id: 'l2', label: 'Left 2' },
    { id: 'l3', label: 'Left 3' },
  ]);
  const [rightTabs, setRightTabs] = useState<TabDescriptor[]>([
    { id: 'r1', label: 'Right 1' },
    { id: 'r2', label: 'Right 2' },
    { id: 'r3', label: 'Right 3' },
  ]);
  const [leftActive, setLeftActive] = useState<string | null>('l1');
  const [rightActive, setRightActive] = useState<string | null>('r1');

  // Refs mirror the latest state so movePanel can read the source strip's
  // current contents without stale-closure problems during a drop.
  const leftRef = useRef(leftTabs);
  const rightRef = useRef(rightTabs);
  leftRef.current = leftTabs;
  rightRef.current = rightTabs;

  // Single atomic move handler. Handles both within-strip reorders and
  // cross-strip moves by updating source and target state together.
  const movePanel = useCallback(
    (panelId: string, sourceGroupId: string, targetGroupId: string, toIndex: number) => {
      const sourceTabs = sourceGroupId === 'left' ? leftRef.current : rightRef.current;
      const tab = sourceTabs.find((t) => t.id === panelId);
      if (!tab) return;

      if (sourceGroupId === targetGroupId) {
        // Reorder within same strip.
        const setter = sourceGroupId === 'left' ? setLeftTabs : setRightTabs;
        setter((prev) => {
          const without = prev.filter((t) => t.id !== panelId);
          const clamped = Math.max(0, Math.min(toIndex, without.length));
          return [...without.slice(0, clamped), tab, ...without.slice(clamped)];
        });
      } else {
        // Cross-strip move: remove from source, insert into target.
        const sourceSetter = sourceGroupId === 'left' ? setLeftTabs : setRightTabs;
        const targetSetter = targetGroupId === 'left' ? setLeftTabs : setRightTabs;
        sourceSetter((prev) => prev.filter((t) => t.id !== panelId));
        targetSetter((prev) => {
          if (prev.some((t) => t.id === panelId)) return prev;
          const clamped = Math.max(0, Math.min(toIndex, prev.length));
          return [...prev.slice(0, clamped), tab, ...prev.slice(clamped)];
        });
      }
    },
    []
  );

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <CrossStrip
        label="Left strip"
        groupId="left"
        tabs={leftTabs}
        activeId={leftActive}
        onActivate={(id) => {
          logAction('onActivate[left]')(id);
          setLeftActive(id);
        }}
        onMove={movePanel}
      />
      <CrossStrip
        label="Right strip"
        groupId="right"
        tabs={rightTabs}
        activeId={rightActive}
        onActivate={(id) => {
          logAction('onActivate[right]')(id);
          setRightActive(id);
        }}
        onMove={movePanel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story 4: Drop on empty space creates a new strip
// ---------------------------------------------------------------------------

/**
 * Tiny strip used by the empty-space demo. Supports up to 3 unrolled hook
 * calls — adequate for the small starter strips in this story.
 */
interface EmptySpaceStripProps {
  label: string;
  groupId: string;
  tabs: TabDescriptor[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onMove: (panelId: string, sourceGroupId: string, targetGroupId: string, toIndex: number) => void;
}

function EmptySpaceStrip({
  label,
  groupId,
  tabs,
  activeId,
  onActivate,
  onMove,
}: EmptySpaceStripProps) {
  const slot0 = tabs[0];
  const slot1 = tabs[1];
  const slot2 = tabs[2];

  const drag0 = useTabDragSource(
    slot0 ? { kind: 'dockable-tab', panelId: slot0.id, sourceGroupId: groupId } : null
  );
  const drag1 = useTabDragSource(
    slot1 ? { kind: 'dockable-tab', panelId: slot1.id, sourceGroupId: groupId } : null
  );
  const drag2 = useTabDragSource(
    slot2 ? { kind: 'dockable-tab', panelId: slot2.id, sourceGroupId: groupId } : null
  );
  const dragProps = [drag0, drag1, drag2];

  const stripRef = useRef<HTMLDivElement | null>(null);
  const { ref: dropRef, isDragOver } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => {
      logAction(`onDrop[${groupId}]`)(payload);
      const strip = stripRef.current;
      if (!strip) return;
      const toIndex = computeDropIndex(strip, event.clientX);
      onMove(payload.panelId, payload.sourceGroupId, groupId, toIndex);
    },
  });

  const assignRef = (el: HTMLDivElement | null) => {
    stripRef.current = el;
    dropRef(el);
  };

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={assignRef}
      style={{
        flex: 1,
        outline: isDragOver ? '2px dashed #3b82f6' : '1px solid #334155',
        padding: 6,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>{label}</div>
      <Tabs
        aria-label={`${label} Tabs`}
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={onActivate}
      />
    </div>
  );
}

interface NewStripDropZoneProps {
  onCreate: (panelId: string, sourceGroupId: string) => void;
}

function NewStripDropZone({ onCreate }: NewStripDropZoneProps) {
  const { ref, isDragOver } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload) => {
      logAction('onDrop[empty-space]')(payload);
      onCreate(payload.panelId, payload.sourceGroupId);
    },
  });
  return (
    <div
      ref={ref}
      style={{
        marginTop: 24,
        padding: 24,
        border: `2px dashed ${isDragOver ? '#3b82f6' : '#64748b'}`,
        borderRadius: 6,
        textAlign: 'center',
        fontSize: '0.8rem',
        opacity: 0.8,
      }}
    >
      Drop a tab here to create a new strip
    </div>
  );
}

function EmptySpaceHarness() {
  const [leftTabs, setLeftTabs] = useState<TabDescriptor[]>([
    { id: 'p1', label: 'Panel 1' },
    { id: 'p2', label: 'Panel 2' },
  ]);
  const [rightTabs, setRightTabs] = useState<TabDescriptor[]>([
    { id: 'p3', label: 'Panel 3' },
    { id: 'p4', label: 'Panel 4' },
  ]);
  const [thirdTabs, setThirdTabs] = useState<TabDescriptor[] | null>(null);
  const [activeLeft, setActiveLeft] = useState<string | null>('p1');
  const [activeRight, setActiveRight] = useState<string | null>('p3');
  const [activeThird, setActiveThird] = useState<string | null>(null);

  // Refs mirror the latest state so move/create handlers can read a
  // source strip's current contents without stale-closure problems.
  const leftRef = useRef(leftTabs);
  const rightRef = useRef(rightTabs);
  const thirdRef = useRef(thirdTabs);
  leftRef.current = leftTabs;
  rightRef.current = rightTabs;
  thirdRef.current = thirdTabs;

  // Helpers: pick the current-tabs ref and setter for a given groupId.
  const readTabs = (groupId: string): TabDescriptor[] => {
    if (groupId === 'a') return leftRef.current;
    if (groupId === 'b') return rightRef.current;
    return thirdRef.current ?? [];
  };
  const getSetter = (groupId: string) => {
    if (groupId === 'a') return setLeftTabs;
    if (groupId === 'b') return setRightTabs;
    // For the third strip, wrap the setter so it matches the same
    // (prev: TabDescriptor[]) => TabDescriptor[] shape.
    return (updater: (prev: TabDescriptor[]) => TabDescriptor[]) => {
      setThirdTabs((prev) => updater(prev ?? []));
    };
  };

  // Single atomic move handler for within-strip reorders and
  // cross-strip moves between any two existing strips.
  const movePanel = useCallback(
    (panelId: string, sourceGroupId: string, targetGroupId: string, toIndex: number) => {
      const sourceTabs = readTabs(sourceGroupId);
      const tab = sourceTabs.find((t) => t.id === panelId);
      if (!tab) return;

      if (sourceGroupId === targetGroupId) {
        const setter = getSetter(sourceGroupId);
        setter((prev) => {
          const without = prev.filter((t) => t.id !== panelId);
          const clamped = Math.max(0, Math.min(toIndex, without.length));
          return [...without.slice(0, clamped), tab, ...without.slice(clamped)];
        });
        return;
      }

      const sourceSetter = getSetter(sourceGroupId);
      const targetSetter = getSetter(targetGroupId);
      sourceSetter((prev) => prev.filter((t) => t.id !== panelId));
      targetSetter((prev) => {
        if (prev.some((t) => t.id === panelId)) return prev;
        const clamped = Math.max(0, Math.min(toIndex, prev.length));
        return [...prev.slice(0, clamped), tab, ...prev.slice(clamped)];
      });

      if (targetGroupId === 'a') setActiveLeft(panelId);
      else if (targetGroupId === 'b') setActiveRight(panelId);
      else setActiveThird(panelId);
    },
    // readTabs/getSetter close over refs/setters which are all stable.
    []
  );

  // Spawns the third strip from a panel dragged out of an existing strip.
  // Reads the panel from the source strip's ref so we never rely on stale
  // props, then removes it from the source (and only the source) — the
  // newly-created third strip is not clobbered.
  const createThirdStripFromPanel = useCallback((panelId: string, sourceGroupId: string) => {
    const sourceTabs = readTabs(sourceGroupId);
    const tab = sourceTabs.find((t) => t.id === panelId);
    if (!tab) return;

    setThirdTabs((prev) => {
      if (prev && prev.some((t) => t.id === panelId)) return prev;
      const base = prev ?? [];
      return [...base, tab];
    });
    setActiveThird(panelId);

    if (sourceGroupId === 'a') {
      setLeftTabs((prev) => prev.filter((t) => t.id !== panelId));
    } else if (sourceGroupId === 'b') {
      setRightTabs((prev) => prev.filter((t) => t.id !== panelId));
    } else {
      setThirdTabs((prev) => (prev ? prev.filter((t) => t.id !== panelId) : prev));
    }
    // readTabs closes over refs which are always current; setters are stable.
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: 24 }}>
        <EmptySpaceStrip
          label="Strip A"
          groupId="a"
          tabs={leftTabs}
          activeId={activeLeft}
          onActivate={(id) => {
            logAction('onActivate[a]')(id);
            setActiveLeft(id);
          }}
          onMove={movePanel}
        />
        <EmptySpaceStrip
          label="Strip B"
          groupId="b"
          tabs={rightTabs}
          activeId={activeRight}
          onActivate={(id) => {
            logAction('onActivate[b]')(id);
            setActiveRight(id);
          }}
          onMove={movePanel}
        />
      </div>
      {thirdTabs ? (
        <div style={{ marginTop: 24 }}>
          <EmptySpaceStrip
            label="Strip C (new)"
            groupId="c"
            tabs={thirdTabs}
            activeId={activeThird}
            onActivate={(id) => {
              logAction('onActivate[c]')(id);
              setActiveThird(id);
            }}
            onMove={movePanel}
          />
        </div>
      ) : (
        <NewStripDropZone onCreate={createThirdStripFromPanel} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story 5: Type safety demo — two strips, incompatible payload kinds
// ---------------------------------------------------------------------------

function ClusterOnlyStrip() {
  const [tabs, setTabs] = useState<TabDescriptor[]>([
    { id: 'ca', label: 'Cluster A' },
    { id: 'cb', label: 'Cluster B' },
    { id: 'cc', label: 'Cluster C' },
    { id: 'cd', label: 'Cluster D' },
  ]);
  const [activeId, setActiveId] = useState<string | null>('ca');

  // Slot-bound hooks: each slot reads the CURRENT tab at that index so the
  // payload stays in sync after reorders. Empty slots pass null.
  const drag0 = useTabDragSource(tabs[0] ? { kind: 'cluster-tab', clusterId: tabs[0].id } : null);
  const drag1 = useTabDragSource(tabs[1] ? { kind: 'cluster-tab', clusterId: tabs[1].id } : null);
  const drag2 = useTabDragSource(tabs[2] ? { kind: 'cluster-tab', clusterId: tabs[2].id } : null);
  const drag3 = useTabDragSource(tabs[3] ? { kind: 'cluster-tab', clusterId: tabs[3].id } : null);
  const dragProps = [drag0, drag1, drag2, drag3];

  const stripRef = useRef<HTMLDivElement | null>(null);
  const { ref: dropRef, isDragOver } = useTabDropTarget({
    accepts: ['cluster-tab'],
    onDrop: (payload, event) => {
      logAction('onDrop[cluster-only]')(payload);
      const strip = stripRef.current;
      if (!strip) return;
      const toIndex = computeDropIndex(strip, event.clientX);
      setTabs((prev) => reorder(prev, payload.clusterId, toIndex));
    },
  });

  const assignRef = (el: HTMLDivElement | null) => {
    stripRef.current = el;
    dropRef(el);
  };

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={assignRef}
      style={{
        flex: 1,
        outline: isDragOver ? '2px dashed #3b82f6' : '1px solid #334155',
        padding: 6,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>
        Cluster strip (accepts cluster-tab only)
      </div>
      <Tabs
        aria-label="Cluster-only Strip"
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate[cluster-only]')(id);
          setActiveId(id);
        }}
      />
    </div>
  );
}

function DockableOnlyStrip() {
  const [tabs, setTabs] = useState<TabDescriptor[]>([
    { id: 'pa', label: 'Panel A' },
    { id: 'pb', label: 'Panel B' },
    { id: 'pc', label: 'Panel C' },
    { id: 'pd', label: 'Panel D' },
  ]);
  const [activeId, setActiveId] = useState<string | null>('pa');

  // Slot-bound hooks: each slot reads the CURRENT tab at that index so the
  // payload stays in sync after reorders. Empty slots pass null.
  const drag0 = useTabDragSource(
    tabs[0] ? { kind: 'dockable-tab', panelId: tabs[0].id, sourceGroupId: 'type-demo' } : null
  );
  const drag1 = useTabDragSource(
    tabs[1] ? { kind: 'dockable-tab', panelId: tabs[1].id, sourceGroupId: 'type-demo' } : null
  );
  const drag2 = useTabDragSource(
    tabs[2] ? { kind: 'dockable-tab', panelId: tabs[2].id, sourceGroupId: 'type-demo' } : null
  );
  const drag3 = useTabDragSource(
    tabs[3] ? { kind: 'dockable-tab', panelId: tabs[3].id, sourceGroupId: 'type-demo' } : null
  );
  const dragProps = [drag0, drag1, drag2, drag3];

  const stripRef = useRef<HTMLDivElement | null>(null);
  const { ref: dropRef, isDragOver } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => {
      logAction('onDrop[dockable-only]')(payload);
      const strip = stripRef.current;
      if (!strip) return;
      const toIndex = computeDropIndex(strip, event.clientX);
      setTabs((prev) => reorder(prev, payload.panelId, toIndex));
    },
  });

  const assignRef = (el: HTMLDivElement | null) => {
    stripRef.current = el;
    dropRef(el);
  };

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={assignRef}
      style={{
        flex: 1,
        outline: isDragOver ? '2px dashed #3b82f6' : '1px solid #334155',
        padding: 6,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>
        Dockable strip (accepts dockable-tab only)
      </div>
      <Tabs
        aria-label="Dockable-only Strip"
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate[dockable-only]')(id);
          setActiveId(id);
        }}
      />
    </div>
  );
}

function TypeSafetyHarness() {
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <ClusterOnlyStrip />
      <DockableOnlyStrip />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story 6: Tear-off seam
// ---------------------------------------------------------------------------

function TearOffStrip() {
  const [tabs, setTabs] = useState<TabDescriptor[]>([
    { id: 't1', label: 'Tab 1' },
    { id: 't2', label: 'Tab 2' },
    { id: 't3', label: 'Tab 3' },
  ]);
  const [activeId, setActiveId] = useState<string | null>('t1');

  // Slot-bound hooks: each slot reads the CURRENT tab at that index so the
  // payload stays in sync after reorders. Empty slots pass null.
  const drag0 = useTabDragSource(
    tabs[0] ? { kind: 'dockable-tab', panelId: tabs[0].id, sourceGroupId: 'tear-off' } : null
  );
  const drag1 = useTabDragSource(
    tabs[1] ? { kind: 'dockable-tab', panelId: tabs[1].id, sourceGroupId: 'tear-off' } : null
  );
  const drag2 = useTabDragSource(
    tabs[2] ? { kind: 'dockable-tab', panelId: tabs[2].id, sourceGroupId: 'tear-off' } : null
  );
  const dragProps = [drag0, drag1, drag2];

  const stripRef = useRef<HTMLDivElement | null>(null);
  const { ref: dropRef, isDragOver } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => {
      logAction('onDrop[tear-off]')(payload);
      const strip = stripRef.current;
      if (!strip) return;
      const toIndex = computeDropIndex(strip, event.clientX);
      setTabs((prev) => reorder(prev, payload.panelId, toIndex));
    },
  });

  const assignRef = (el: HTMLDivElement | null) => {
    stripRef.current = el;
    dropRef(el);
  };

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={assignRef}
      style={{ outline: isDragOver ? '2px dashed #3b82f6' : 'none', padding: 4 }}
    >
      <Tabs
        aria-label="Tear-off Demo Tabs"
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate[tear-off]')(id);
          setActiveId(id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta + story exports
// ---------------------------------------------------------------------------

/**
 * Provider wrapper used by every story. Storybook's component arg is just
 * a thin passthrough to TabDragProvider so each story can customize
 * onTearOff via args without re-declaring the provider.
 */
interface ProviderWrapperProps {
  children: React.ReactNode;
  wrapperStyle?: CSSProperties;
  onTearOff?: (payload: TabDragPayload, cursor: { x: number; y: number }) => void;
}

function ProviderWrapper({ children, wrapperStyle, onTearOff }: ProviderWrapperProps) {
  const content = <TabDragProvider onTearOff={onTearOff}>{children}</TabDragProvider>;
  return wrapperStyle ? <div style={wrapperStyle}>{content}</div> : content;
}

const meta: Meta<typeof ProviderWrapper> = {
  title: 'Shared/Tabs (Drag)',
  component: ProviderWrapper,
  decorators: [ThemeProviderDecorator],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof ProviderWrapper>;

/** Reorder 5 cluster tabs within a single strip. Uses the default drag image. */
export const WithinStripReorderClusterStyle: Story = {
  render: () => (
    <ProviderWrapper>
      <ClusterReorderStrip />
    </ProviderWrapper>
  ),
};

/** Reorder 5 dockable tabs within a single strip. Uses a custom drag image. */
export const WithinStripReorderDockableStyle: Story = {
  render: () => (
    <ProviderWrapper>
      <DockableReorderStrip />
    </ProviderWrapper>
  ),
};

/** Two side-by-side strips — tabs can be reordered within or moved between. */
export const CrossStripDragDockableStyle: Story = {
  render: () => (
    <ProviderWrapper>
      <CrossStripHarness />
    </ProviderWrapper>
  ),
};

/** Two strips plus a dashed empty-space drop zone that spawns a third strip. */
export const DropOnEmptySpaceCreatesNewStrip: Story = {
  render: () => (
    <ProviderWrapper>
      <EmptySpaceHarness />
    </ProviderWrapper>
  ),
};

/**
 * Two strips accepting disjoint payload kinds. Dropping across them is
 * impossible because the discriminated union prevents the drop target
 * from receiving a kind it did not declare in `accepts`.
 */
export const TypeSafetyDemo: Story = {
  render: () => (
    <ProviderWrapper>
      <TypeSafetyHarness />
    </ProviderWrapper>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The discriminated union payload makes cross-system drops impossible ' +
          'by construction. Try dragging a tab from the cluster strip onto the ' +
          "dockable strip — it won't work, even though both look identical.",
      },
    },
  },
};

/**
 * Tear-off seam demo. Drag a tab outside the Storybook iframe and watch
 * the browser console for a 'tearOff' event.
 */
export const TearOffSeam: Story = {
  render: () => (
    <ProviderWrapper onTearOff={(payload, cursor) => logAction('tearOff')({ payload, cursor })}>
      <TearOffStrip />
    </ProviderWrapper>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Drag a tab outside the Storybook iframe bounds (drag it past the ' +
          'right edge of the visible area). The tear-off seam fires when the ' +
          'drop happens outside any registered target AND outside the window ' +
          "bounds. Currently no production consumer wires this — it's a " +
          "future-Wails-v3 hook. The console will log a 'tearOff' event with " +
          'the payload and cursor coordinates.',
      },
    },
  },
};
