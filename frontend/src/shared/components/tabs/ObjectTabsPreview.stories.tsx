/**
 * frontend/src/shared/components/tabs/ObjectTabsPreview.stories.tsx
 *
 * Preview of the Dockable "Object Tabs" tab strip after Phase 2 migrates
 * `DockableTabBar.tsx` to use the shared <Tabs> component. Renders TWO
 * side-by-side strips plus a dashed empty-space drop zone that spawns a
 * third strip on drop, all wired to the shared drag coordinator — so
 * this single story exercises every production drag pattern at once:
 *
 *   • within-strip reorder (drag a tab over its own strip)
 *   • cross-strip move (drag a tab into the neighbor strip)
 *   • empty-space creation (drop a tab on the dashed zone to spawn a
 *     new strip)
 *
 * Each strip uses the real dockable kind indicators (via production
 * `.dockable-tab__kind-indicator.kind-badge` rules) and a real custom
 * drag preview (via the production `.dockable-tab-drag-preview` class)
 * so the styling path matches what the live app will do post-migration.
 *
 * This file PARALLELS the existing Dockable tab bar — it does not
 * replace it. The real migration (DockableTabBar.tsx and
 * DockablePanelProvider.tsx) is Phase 2 and is intentionally untouched
 * here.
 *
 * Per the design doc, the Dockable wrapper's aria-label is literally
 * "Object Tabs" and the tab labels render in their natural case (no
 * uppercase transform, unlike the Object Panel preview).
 *
 * Hooks-rules note: React forbids calling hooks inside loops or
 * callbacks, so `useTabDragSource` can't be invoked from inside
 * `.map()`. Each strip unrolls 8 hook calls at the top level of its
 * body — 8 is the current max number of tabs any single strip can hold
 * (all eight tabs start split between strips A and B, and all eight
 * could theoretically end up in one strip after drags).
 */

import { useCallback, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { Tabs, type TabDescriptor } from './';
import { TabDragProvider, useTabDragSource, useTabDropTarget } from './dragCoordinator';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';
// Import the real dockable panel CSS so the preview renders each tab's
// kind indicator via the production `.dockable-tab__kind-indicator.kind-badge`
// rules AND the custom drag image via the real `.dockable-tab-drag-preview`
// class. Matches the styling path the live app will use post-migration.
import '../../../ui/dockable/DockablePanel.css';
import './stories.css';

const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[ObjectTabsPreview story] ${name}`, ...args);
  };

// Small colored kind-indicator span. Markup is byte-identical to the
// live DockableTabBar: `<span class="dockable-tab__kind-indicator
// kind-badge <kind>" aria-hidden />`. The `.dockable-tab__kind-indicator
// .kind-badge` override in DockablePanel.css turns the badge into a 10x10
// colored dot; the kind-specific class (e.g. `.kind-badge.deployment`)
// drives the final color from `styles/components/badges.css`.
const kindIndicator = (kindClass: string) => (
  <span className={`dockable-tab__kind-indicator kind-badge ${kindClass}`} aria-hidden="true" />
);

/**
 * Minimal per-tab metadata. Kept separate from `TabDescriptor` so the
 * reorder / cross-strip move state works on a plain data shape, with
 * descriptors derived on each render.
 */
interface TabMeta {
  id: string;
  label: string;
  /** Undefined for panels without a k8s kind (logs, diagnostics). */
  kindClass?: string;
}

const INITIAL_GROUP_A: TabMeta[] = [
  { id: 'panel-deployment-nginx', label: 'deployment/nginx-frontend', kindClass: 'deployment' },
  { id: 'panel-pod-api', label: 'pod/api-server-7d4f5b8c9-xkvm2', kindClass: 'pod' },
  { id: 'panel-configmap', label: 'configmap/app-config', kindClass: 'configmap' },
  { id: 'panel-logs-api', label: 'logs: api-server' },
];

const INITIAL_GROUP_B: TabMeta[] = [
  { id: 'panel-service-api', label: 'service/api-server', kindClass: 'service' },
  { id: 'panel-secret-tls', label: 'secret/ingress-tls-cert', kindClass: 'secret' },
  { id: 'panel-ingress', label: 'ingress/public-gateway', kindClass: 'ingress' },
  { id: 'panel-diagnostics', label: 'diagnostics' },
];

interface ObjectTabsPreviewStripProps {
  groupId: string;
  label: string;
  tabs: TabMeta[];
  activeId: string | null;
  onActivate: (id: string) => void;
  /**
   * Move a tab to a new position. Called for BOTH within-strip reorders
   * (sourceGroupId === targetGroupId) and cross-strip moves. The parent
   * harness owns all strips' state and atomically updates source +
   * target on every call.
   */
  onMove: (panelId: string, sourceGroupId: string, targetGroupId: string, toIndex: number) => void;
}

/**
 * A single dockable tabs strip: renders its tabs via the shared <Tabs>
 * component, wires a drag source per slot, and acts as a drop target
 * for the `dockable-tab` payload. Also owns its own
 * `.dockable-tab-drag-preview` element (one per strip; only one is
 * visible at a time, namely the one belonging to the strip being
 * dragged from).
 */
function ObjectTabsPreviewStrip({
  groupId,
  label,
  tabs,
  activeId,
  onActivate,
  onMove,
}: ObjectTabsPreviewStripProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewKindRef = useRef<HTMLSpanElement | null>(null);
  const previewLabelRef = useRef<HTMLSpanElement | null>(null);

  // Factory for per-slot getDragImage callbacks. Bound to the CURRENT
  // tab at each slot index. Updates the preview's kind class + label
  // text before returning the element to setDragImage, so the floating
  // preview always matches the dragged tab.
  const makeGetDragImage = (slotIndex: number) => () => {
    const tab = tabs[slotIndex];
    if (!previewRef.current || !previewKindRef.current || !previewLabelRef.current || !tab) {
      return null;
    }
    previewLabelRef.current.textContent = tab.label;
    previewKindRef.current.className = `dockable-tab-drag-preview__kind kind-badge${
      tab.kindClass ? ` ${tab.kindClass}` : ''
    }`;
    return { element: previewRef.current, offsetX: 14, offsetY: 16 };
  };

  // Unrolled hook calls — one per slot, up to 8 (the max number of tabs
  // that could end up in a single strip after drags).
  const drag0 = useTabDragSource(
    tabs[0] ? { kind: 'dockable-tab', panelId: tabs[0].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(0) }
  );
  const drag1 = useTabDragSource(
    tabs[1] ? { kind: 'dockable-tab', panelId: tabs[1].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(1) }
  );
  const drag2 = useTabDragSource(
    tabs[2] ? { kind: 'dockable-tab', panelId: tabs[2].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(2) }
  );
  const drag3 = useTabDragSource(
    tabs[3] ? { kind: 'dockable-tab', panelId: tabs[3].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(3) }
  );
  const drag4 = useTabDragSource(
    tabs[4] ? { kind: 'dockable-tab', panelId: tabs[4].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(4) }
  );
  const drag5 = useTabDragSource(
    tabs[5] ? { kind: 'dockable-tab', panelId: tabs[5].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(5) }
  );
  const drag6 = useTabDragSource(
    tabs[6] ? { kind: 'dockable-tab', panelId: tabs[6].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(6) }
  );
  const drag7 = useTabDragSource(
    tabs[7] ? { kind: 'dockable-tab', panelId: tabs[7].id, sourceGroupId: groupId } : null,
    { getDragImage: makeGetDragImage(7) }
  );
  const dragProps = [drag0, drag1, drag2, drag3, drag4, drag5, drag6, drag7];

  const {
    ref: dropRef,
    isDragOver,
    dropInsertIndex,
  } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, _event, insertIndex) => {
      logAction(`onDrop[${groupId}]`)(payload, insertIndex);
      onMove(payload.panelId, payload.sourceGroupId, groupId, insertIndex);
    },
  });

  const tabDescriptors: TabDescriptor[] = tabs.map((tab, i) => ({
    id: tab.id,
    label: tab.label,
    leading: tab.kindClass ? kindIndicator(tab.kindClass) : undefined,
    onClose: () => logAction('onClose')(tab.id),
    extraProps: dragProps[i],
  }));

  return (
    <>
      <div
        ref={dropRef as (el: HTMLDivElement | null) => void}
        className={`tabs-story-drag-strip${isDragOver ? ' tabs-story-drag-strip--drag-over' : ''}`}
      >
        <div className="tabs-story-drag-strip__label">{label}</div>
        <Tabs
          aria-label={`${label} Tabs`}
          tabs={tabDescriptors}
          activeId={activeId}
          onActivate={onActivate}
          dropInsertIndex={dropInsertIndex}
        />
      </div>
      {/* Custom drag preview owned by this strip. Each strip mounts its
          own preview element offscreen (via the class's default
          `transform: translate3d(var(--dockable-tab-drag-x, -9999px), ...)`
          rule). Only one is ever the active drag source at a time. */}
      <div ref={previewRef} className="dockable-tab-drag-preview" aria-hidden="true">
        <span
          ref={previewKindRef}
          className="dockable-tab-drag-preview__kind kind-badge deployment"
        />
        <span ref={previewLabelRef} className="dockable-tab-drag-preview__label">
          Drag preview
        </span>
      </div>
    </>
  );
}

interface NewStripDropZoneProps {
  onCreate: (panelId: string, sourceGroupId: string) => void;
}

/**
 * Dashed drop zone that spawns a third strip on drop. Accepts
 * dockable-tab payloads from any existing strip. The caller-provided
 * `onCreate` removes the panel from its source strip and pushes it into
 * a new strip C.
 */
function NewStripDropZone({ onCreate }: NewStripDropZoneProps) {
  const { ref, isDragOver } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload) => {
      logAction('onDrop[new-strip]')(payload);
      onCreate(payload.panelId, payload.sourceGroupId);
    },
  });
  return (
    <div
      ref={ref}
      className={`tabs-story-drop-zone${isDragOver ? ' tabs-story-drop-zone--drag-over' : ''}`}
    >
      Drop a tab here to create a new Object Tabs strip
    </div>
  );
}

/** A single strip's runtime state, held in the harness-level groups array. */
interface TabGroup {
  id: string;
  label: string;
  tabs: TabMeta[];
  activeId: string | null;
}

/**
 * Generate the next available group id by walking the alphabet until
 * finding one not in `existing`. Falls back to a timestamped id if all
 * of `a`-`z` are taken (not expected in practice, but defensive).
 */
function nextGroupId(existing: Set<string>): string {
  for (let code = 'a'.charCodeAt(0); code <= 'z'.charCodeAt(0); code++) {
    const candidate = String.fromCharCode(code);
    if (!existing.has(candidate)) return candidate;
  }
  return `strip-${Date.now()}`;
}

/**
 * Parent harness that owns every strip's tabs and active state. Handles
 * within-strip reorders, cross-strip moves, and new-strip creation on
 * drop-to-empty-space atomically. Unlike the previous A/B/C version,
 * this harness supports an arbitrary number of groups — each drop on
 * the empty-space zone spawns a brand-new group rather than appending
 * to a pre-allocated third slot.
 */
function ObjectTabsPreviewHarness() {
  const [groups, setGroups] = useState<TabGroup[]>(() => [
    {
      id: 'a',
      label: 'Object Panel A',
      tabs: INITIAL_GROUP_A,
      activeId: INITIAL_GROUP_A[0]?.id ?? null,
    },
    {
      id: 'b',
      label: 'Object Panel B',
      tabs: INITIAL_GROUP_B,
      activeId: INITIAL_GROUP_B[0]?.id ?? null,
    },
  ]);

  // Atomic move handler — handles within-strip reorders AND cross-strip
  // moves in a single `setGroups` pass so React commits both sides of
  // the move together. Auto-removes any group left with zero tabs after
  // the move (matches the live dockable behavior, where a panel
  // auto-closes when you drag its last tab out).
  const movePanel = useCallback(
    (panelId: string, sourceGroupId: string, targetGroupId: string, toIndex: number) => {
      setGroups((prev) => {
        const sourceGroup = prev.find((g) => g.id === sourceGroupId);
        const tab = sourceGroup?.tabs.find((t) => t.id === panelId);
        if (!tab) return prev;

        // Within-strip reorder — tab count is unchanged, so no group can
        // become empty.
        if (sourceGroupId === targetGroupId) {
          return prev.map((g) => {
            if (g.id !== sourceGroupId) return g;
            const without = g.tabs.filter((t) => t.id !== panelId);
            const clamped = Math.max(0, Math.min(toIndex, without.length));
            return {
              ...g,
              tabs: [...without.slice(0, clamped), tab, ...without.slice(clamped)],
            };
          });
        }

        // Cross-strip move: remove from source, insert into target,
        // focus the moved tab in its new home, then drop any group left
        // empty by the move.
        return prev
          .map((g) => {
            if (g.id === sourceGroupId) {
              return { ...g, tabs: g.tabs.filter((t) => t.id !== panelId) };
            }
            if (g.id === targetGroupId) {
              if (g.tabs.some((t) => t.id === panelId)) return g;
              const clamped = Math.max(0, Math.min(toIndex, g.tabs.length));
              return {
                ...g,
                tabs: [...g.tabs.slice(0, clamped), tab, ...g.tabs.slice(clamped)],
                activeId: panelId,
              };
            }
            return g;
          })
          .filter((g) => g.tabs.length > 0);
      });
    },
    []
  );

  // Spawns a BRAND-NEW group from a panel dragged onto the empty-space
  // drop zone. Each drop creates a distinct strip (D, E, F, ...), not
  // an append to a pre-existing "third strip". Removes the source group
  // if the move emptied it.
  const createNewStrip = useCallback((panelId: string, sourceGroupId: string) => {
    setGroups((prev) => {
      const sourceGroup = prev.find((g) => g.id === sourceGroupId);
      const tab = sourceGroup?.tabs.find((t) => t.id === panelId);
      if (!tab) return prev;

      const newId = nextGroupId(new Set(prev.map((g) => g.id)));
      const newGroup: TabGroup = {
        id: newId,
        label: `Object Panel ${newId.toUpperCase()} (new)`,
        tabs: [tab],
        activeId: panelId,
      };

      const withSourceReduced = prev.map((g) =>
        g.id === sourceGroupId ? { ...g, tabs: g.tabs.filter((t) => t.id !== panelId) } : g
      );
      return [...withSourceReduced.filter((g) => g.tabs.length > 0), newGroup];
    });
  }, []);

  const setActiveInGroup = useCallback((groupId: string, id: string | null) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, activeId: id } : g)));
  }, []);

  // Render groups two per row so each strip keeps a realistic width
  // inside the 1280px harness cap. With 1, 2, 3, 4, ... groups, the
  // layout is 1-wide, 2-wide, 2+1, 2+2, 2+2+1, etc.
  const rows: TabGroup[][] = [];
  for (let i = 0; i < groups.length; i += 2) {
    rows.push(groups.slice(i, i + 2));
  }

  return (
    <div className="tabs-story-drag-harness">
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={`tabs-story-drag-row${rowIndex > 0 ? ' tabs-story-drag-row--below' : ''}`}
        >
          {row.map((group) => (
            <ObjectTabsPreviewStrip
              key={group.id}
              groupId={group.id}
              label={group.label}
              tabs={group.tabs}
              activeId={group.activeId}
              onActivate={(id) => {
                logAction(`onActivate[${group.id}]`)(id);
                setActiveInGroup(group.id, id);
              }}
              onMove={movePanel}
            />
          ))}
        </div>
      ))}
      <NewStripDropZone onCreate={createNewStrip} />
    </div>
  );
}

const meta: Meta<typeof ObjectTabsPreviewHarness> = {
  title: 'Shared/Tabs',
  component: ObjectTabsPreviewHarness,
  decorators: [ThemeProviderDecorator],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof ObjectTabsPreviewHarness>;

/**
 * Object Tabs — preview of the Dockable tab strip after Phase 2 migration
 * to the shared <Tabs> component. Renders two side-by-side strips
 * populated with realistic dockable tab data (deployment, pod,
 * configmap, logs, service, secret, ingress, diagnostics) plus a dashed
 * empty-space drop zone. Every drag pattern the live app supports is
 * demonstrable from this single story:
 *
 *   • Within-strip reorder: drag a tab over its own strip.
 *   • Cross-strip move: drag a tab into the neighbor strip.
 *   • New-strip creation: drop a tab on the dashed zone to spawn
 *     Object Panel C.
 *
 * The dragged tab shows a real `.dockable-tab-drag-preview` floating
 * preview that tracks its kind + label, and the drop-position indicator
 * bar inside the target strip shows the exact insertion site.
 */
export const ObjectTabs: Story = {
  render: () => (
    <TabDragProvider>
      <ObjectTabsPreviewHarness />
    </TabDragProvider>
  ),
};
