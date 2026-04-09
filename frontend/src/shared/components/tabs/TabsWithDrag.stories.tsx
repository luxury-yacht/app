/**
 * frontend/src/shared/components/tabs/TabsWithDrag.stories.tsx
 *
 * Storybook stories for the tab drag coordinator. Each story wraps the
 * shared <Tabs> component in a <TabDragProvider> and uses
 * useTabDragSource / useTabDropTarget to demonstrate a drag scenario.
 *
 * This file focuses on the drag scenarios NOT covered by the preview
 * stories. Within-strip reorder, cross-strip moves, and empty-space
 * new-strip creation are all demonstrated by `ObjectTabsPreview.stories.tsx`
 * using the real dockable tab data, so they aren't duplicated here.
 * What remains:
 *
 *   • TypeSafetyDemo — two strips with disjoint payload kinds to prove
 *     the discriminated union prevents cross-system drops.
 *   • TearOffSeam — drag outside the window to fire the tear-off hook.
 *
 * Hooks-rules note: React forbids calling hooks inside loops or
 * callbacks, so useTabDragSource cannot be invoked from inside `.map()`.
 * Each wrapper below unrolls the hook calls to the top level of its
 * component body for a fixed number of tabs. This is mildly repetitive
 * but fully compliant with the rules of hooks.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { Tabs, type TabDescriptor } from './Tabs';
import { TabDragProvider, useTabDragSource, useTabDropTarget } from './dragCoordinator';
import type { TabDragPayload } from './dragCoordinator';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';
import './stories.css';

// Lightweight action logger — mirrors Tabs.stories.tsx since the project
// does not install @storybook/addon-actions. Console output is still
// visible in the browser devtools while clicking around stories.
const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[TabsWithDrag story] ${name}`, ...args);
  };

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
// Type safety demo — two strips with incompatible payload kinds
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

  const {
    ref: dropRef,
    isDragOver,
    dropInsertIndex,
  } = useTabDropTarget({
    accepts: ['cluster-tab'],
    onDrop: (payload, _event, insertIndex) => {
      logAction('onDrop[cluster-only]')(payload, insertIndex);
      setTabs((prev) => reorder(prev, payload.clusterId, insertIndex));
    },
  });

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={dropRef as (el: HTMLDivElement | null) => void}
      className={`tabs-story-drag-strip${isDragOver ? ' tabs-story-drag-strip--drag-over' : ''}`}
    >
      <div className="tabs-story-drag-strip__label">Cluster strip (accepts cluster-tab only)</div>
      <Tabs
        aria-label="Cluster-only Strip"
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate[cluster-only]')(id);
          setActiveId(id);
        }}
        dropInsertIndex={dropInsertIndex}
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

  const {
    ref: dropRef,
    isDragOver,
    dropInsertIndex,
  } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, _event, insertIndex) => {
      logAction('onDrop[dockable-only]')(payload, insertIndex);
      setTabs((prev) => reorder(prev, payload.panelId, insertIndex));
    },
  });

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div
      ref={dropRef as (el: HTMLDivElement | null) => void}
      className={`tabs-story-drag-strip${isDragOver ? ' tabs-story-drag-strip--drag-over' : ''}`}
    >
      <div className="tabs-story-drag-strip__label">Dockable strip (accepts dockable-tab only)</div>
      <Tabs
        aria-label="Dockable-only Strip"
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate[dockable-only]')(id);
          setActiveId(id);
        }}
        dropInsertIndex={dropInsertIndex}
      />
    </div>
  );
}

function TypeSafetyHarness() {
  return (
    <div className="tabs-story-drag-row">
      <ClusterOnlyStrip />
      <DockableOnlyStrip />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tear-off seam
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

  const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, _event, insertIndex) => {
      logAction('onDrop[tear-off]')(payload, insertIndex);
      setTabs((prev) => reorder(prev, payload.panelId, insertIndex));
    },
  });

  const tabsWithDrag: TabDescriptor[] = tabs.map((tab, i) => ({
    ...tab,
    extraProps: dragProps[i],
  }));

  return (
    <div ref={dropRef as (el: HTMLDivElement | null) => void}>
      <Tabs
        aria-label="Tear-off Demo Tabs"
        tabs={tabsWithDrag}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate[tear-off]')(id);
          setActiveId(id);
        }}
        dropInsertIndex={dropInsertIndex}
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
  onTearOff?: (payload: TabDragPayload, cursor: { x: number; y: number }) => void;
}

function ProviderWrapper({ children, onTearOff }: ProviderWrapperProps) {
  return <TabDragProvider onTearOff={onTearOff}>{children}</TabDragProvider>;
}

const meta: Meta<typeof ProviderWrapper> = {
  title: 'Shared/Tabs',
  component: ProviderWrapper,
  decorators: [ThemeProviderDecorator],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof ProviderWrapper>;

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
