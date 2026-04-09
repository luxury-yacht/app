/**
 * frontend/src/shared/components/tabs/ClusterTabsPreview.stories.tsx
 *
 * Preview of the "Cluster Tabs" tab strip after Phase 2 migrates
 * `ClusterTabs.tsx` to use the shared <Tabs> component. Renders a
 * realistic mix of kubeconfig context names (short and long) using the
 * exact configuration the Cluster wrapper will use post-migration, and
 * wires up drag reordering via the shared drag coordinator so the
 * preview exercises the full production interaction surface rather than
 * just static rendering.
 *
 * This file PARALLELS the existing Cluster tabs — it does not replace
 * them. The real migration (ClusterTabs.tsx) is Phase 2 and is
 * intentionally untouched here.
 *
 * Per the design doc, the Cluster wrapper's aria-label is "Cluster Tabs"
 * and the tab labels render in their natural case (no uppercase
 * transform). Cluster tabs don't have kind indicators, so there is no
 * `leading` slot, and the drag preview falls back to the browser default
 * (a translucent snapshot of the dragged tab). One deliberately long
 * context name is included to demonstrate how the default
 * `maxTabWidth: 240` truncates overlong labels.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { Tabs, type TabDescriptor } from './';
import { TabDragProvider, useTabDragSource, useTabDropTarget } from './dragCoordinator';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';
import './stories.css';

// Lightweight action logger. The project doesn't install @storybook/addon-actions,
// so we log to the browser console instead — same pattern as the other
// preview stories.
const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[ClusterTabsPreview story] ${name}`, ...args);
  };

/**
 * Metadata for each cluster tab. Kept separate from `TabDescriptor` so
 * the reorder/drag state works on a minimal data shape, with descriptors
 * derived on each render.
 */
interface ClusterTabMeta {
  id: string;
  label: string;
}

const INITIAL_TABS: ClusterTabMeta[] = [
  { id: 'cluster-prod-east', label: 'production-us-east-1' },
  { id: 'cluster-staging', label: 'staging' },
  { id: 'cluster-minikube', label: 'minikube' },
  { id: 'cluster-dev-eu', label: 'dev-eu-west-2' },
  { id: 'cluster-gke-main', label: 'gke_prod_main_cluster_with_a_long_name' },
  { id: 'cluster-eks-prod', label: 'eks-prod-apac' },
  { id: 'cluster-aks-dev', label: 'aks-dev-westus2' },
  { id: 'cluster-kind-local', label: 'kind-local' },
];

/** Move `fromId` to position `toIndex` in the tab list. */
function reorder(tabs: ClusterTabMeta[], fromId: string, toIndex: number): ClusterTabMeta[] {
  const fromIndex = tabs.findIndex((t) => t.id === fromId);
  if (fromIndex === -1) return tabs;
  const next = tabs.slice();
  const [moved] = next.splice(fromIndex, 1);
  const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(adjusted, 0, moved);
  return next;
}

/**
 * The preview strip component. Owns tab-order state, wires a drag source
 * per slot, and registers the wrapping div as a drop target so reorders
 * persist. Uses the default browser drag image (no `getDragImage`),
 * matching how the live `ClusterTabs.tsx` behaves.
 *
 * Unrolled hook calls (one `useTabDragSource` per slot index 0-7)
 * satisfy React's rules of hooks at a fixed-length tab array. Eight
 * slots is the current tab count.
 */
function ClusterTabsPreviewStrip() {
  const [tabs, setTabs] = useState<ClusterTabMeta[]>(INITIAL_TABS);
  const [activeId, setActiveId] = useState<string | null>('cluster-prod-east');

  const drag0 = useTabDragSource(tabs[0] ? { kind: 'cluster-tab', clusterId: tabs[0].id } : null);
  const drag1 = useTabDragSource(tabs[1] ? { kind: 'cluster-tab', clusterId: tabs[1].id } : null);
  const drag2 = useTabDragSource(tabs[2] ? { kind: 'cluster-tab', clusterId: tabs[2].id } : null);
  const drag3 = useTabDragSource(tabs[3] ? { kind: 'cluster-tab', clusterId: tabs[3].id } : null);
  const drag4 = useTabDragSource(tabs[4] ? { kind: 'cluster-tab', clusterId: tabs[4].id } : null);
  const drag5 = useTabDragSource(tabs[5] ? { kind: 'cluster-tab', clusterId: tabs[5].id } : null);
  const drag6 = useTabDragSource(tabs[6] ? { kind: 'cluster-tab', clusterId: tabs[6].id } : null);
  const drag7 = useTabDragSource(tabs[7] ? { kind: 'cluster-tab', clusterId: tabs[7].id } : null);
  const dragProps = [drag0, drag1, drag2, drag3, drag4, drag5, drag6, drag7];

  const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
    accepts: ['cluster-tab'],
    onDrop: (payload, _event, insertIndex) => {
      logAction('onDrop')(payload, insertIndex);
      setTabs((prev) => reorder(prev, payload.clusterId, insertIndex));
    },
  });

  const tabDescriptors: TabDescriptor[] = tabs.map((tab, i) => ({
    id: tab.id,
    label: tab.label,
    onClose: () => logAction('onClose')(tab.id),
    extraProps: dragProps[i],
  }));

  return (
    <div ref={dropRef as (el: HTMLDivElement | null) => void} className="tabs-story-viewport">
      <Tabs
        aria-label="Cluster Tabs"
        tabs={tabDescriptors}
        activeId={activeId}
        onActivate={(id) => {
          logAction('onActivate')(id);
          setActiveId(id);
        }}
        dropInsertIndex={dropInsertIndex}
      />
    </div>
  );
}

const meta: Meta<typeof ClusterTabsPreviewStrip> = {
  title: 'Shared/Tabs',
  component: ClusterTabsPreviewStrip,
  decorators: [ThemeProviderDecorator],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof ClusterTabsPreviewStrip>;

/**
 * Cluster Tabs — preview of the Cluster tab strip after Phase 2 migration
 * to the shared <Tabs> component. Renders a realistic mix of kubeconfig
 * context names (short and long) with close buttons on every tab, no
 * leading slot, and full drag-reorder support via the shared drag
 * coordinator. The drag preview uses the browser default (no custom
 * `getDragImage`), matching the live `ClusterTabs.tsx` behavior.
 * Configuration matches the Cluster design doc: `aria-label="Cluster Tabs"`,
 * no text transform, default `'fit'` sizing, closeable tabs. The
 * `gke_prod_main_cluster_with_a_long_name` tab demonstrates
 * `maxTabWidth: 240` truncation.
 */
export const ClusterTabs: Story = {
  render: () => (
    <TabDragProvider>
      <ClusterTabsPreviewStrip />
    </TabDragProvider>
  ),
};
