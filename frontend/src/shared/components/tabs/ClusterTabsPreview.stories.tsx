/**
 * frontend/src/shared/components/tabs/ClusterTabsPreview.stories.tsx
 *
 * Preview of the "Cluster Tabs" tab strip after Phase 2 migrates
 * `ClusterTabs.tsx` to use the shared <Tabs> component. Renders a
 * realistic mix of kubeconfig context names (short and long) using the
 * exact configuration the Cluster wrapper will use post-migration.
 *
 * This file PARALLELS the existing Cluster tabs — it does not replace
 * them. The real migration (ClusterTabs.tsx) is Phase 2 and is
 * intentionally untouched here.
 *
 * Per the design doc, the Cluster wrapper's aria-label is "Cluster Tabs"
 * and the tab labels render in their natural case (no uppercase
 * transform). Cluster tabs don't have kind indicators, so there is no
 * `leading` slot. One deliberately long context name is included to
 * demonstrate how the default `maxTabWidth: 240` truncates overlong
 * labels.
 */

import { useState, type CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, type TabDescriptor, type TabsProps } from './';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';

// Lightweight action logger. The project doesn't install @storybook/addon-actions,
// so we log to the browser console instead — same pattern as Tabs.stories.tsx
// and ObjectPanelTabsPreview.stories.tsx.
const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[ClusterTabsPreview story] ${name}`, ...args);
  };

/**
 * Small wrapper that owns `activeId` state so the story can render the
 * fully-controlled <Tabs> without boilerplate. Mirrors the TabsHarness
 * pattern used in ObjectPanelTabsPreview.stories.tsx.
 */
interface TabsHarnessProps extends Omit<TabsProps, 'activeId' | 'onActivate'> {
  initialActiveId: string | null;
  wrapperStyle?: CSSProperties;
}

function TabsHarness({ initialActiveId, wrapperStyle, tabs, ...rest }: TabsHarnessProps) {
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const handleActivate = (id: string) => {
    logAction('onActivate')(id);
    setActiveId(id);
  };
  const content = <Tabs {...rest} tabs={tabs} activeId={activeId} onActivate={handleActivate} />;
  return wrapperStyle ? <div style={wrapperStyle}>{content}</div> : content;
}

// Constrain the width so the strip renders in context instead of stretching
// to fill the Storybook canvas. The strip brings its own background and
// bottom border via tabs.css; we don't add any chrome of our own.
const panelWrapperStyle: CSSProperties = {
  width: 600,
};

// Tab descriptors using realistic kubeconfig context names so the preview
// reflects what Cluster labels actually look like in the real app. The
// last entry is deliberately long to demonstrate how the default
// `maxTabWidth: 240` truncates overlong context names.
const PROD_EAST_TAB: TabDescriptor = {
  id: 'cluster-prod-east',
  label: 'production-us-east-1',
  onClose: () => logAction('onClose')('cluster-prod-east'),
};
const STAGING_TAB: TabDescriptor = {
  id: 'cluster-staging',
  label: 'staging',
  onClose: () => logAction('onClose')('cluster-staging'),
};
const MINIKUBE_TAB: TabDescriptor = {
  id: 'cluster-minikube',
  label: 'minikube',
  onClose: () => logAction('onClose')('cluster-minikube'),
};
const DEV_EU_TAB: TabDescriptor = {
  id: 'cluster-dev-eu',
  label: 'dev-eu-west-2',
  onClose: () => logAction('onClose')('cluster-dev-eu'),
};
const GKE_MAIN_TAB: TabDescriptor = {
  id: 'cluster-gke-main',
  label: 'gke_prod_main_cluster_with_a_long_name',
  onClose: () => logAction('onClose')('cluster-gke-main'),
};
const EKS_PROD_TAB: TabDescriptor = {
  id: 'cluster-eks-prod',
  label: 'eks-prod-apac',
  onClose: () => logAction('onClose')('cluster-eks-prod'),
};
const AKS_DEV_TAB: TabDescriptor = {
  id: 'cluster-aks-dev',
  label: 'aks-dev-westus2',
  onClose: () => logAction('onClose')('cluster-aks-dev'),
};
const KIND_LOCAL_TAB: TabDescriptor = {
  id: 'cluster-kind-local',
  label: 'kind-local',
  onClose: () => logAction('onClose')('cluster-kind-local'),
};

const meta: Meta<typeof TabsHarness> = {
  title: 'Shared/Tabs',
  component: TabsHarness,
  decorators: [ThemeProviderDecorator],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof TabsHarness>;

/**
 * Cluster Tabs — preview of the Cluster tab strip after Phase 2 migration
 * to the shared <Tabs> component. Renders a realistic mix of kubeconfig
 * context names (short and long) with close buttons on every tab and no
 * leading slot. Configuration matches the Cluster design doc:
 * `aria-label="Cluster Tabs"`, no text transform (natural case), default
 * `'fit'` sizing, closeable tabs, no kind indicators. The last tab has a
 * deliberately long label to demonstrate `maxTabWidth: 240` truncation.
 */
export const ClusterTabs: Story = {
  args: {
    'aria-label': 'Cluster Tabs',
    initialActiveId: 'cluster-prod-east',
    tabs: [
      PROD_EAST_TAB,
      STAGING_TAB,
      MINIKUBE_TAB,
      DEV_EU_TAB,
      GKE_MAIN_TAB,
      EKS_PROD_TAB,
      AKS_DEV_TAB,
      KIND_LOCAL_TAB,
    ],
    wrapperStyle: panelWrapperStyle,
  },
};
