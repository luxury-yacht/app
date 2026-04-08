/**
 * frontend/src/shared/components/tabs/ObjectTabsPreview.stories.tsx
 *
 * Preview of the Dockable "Object Tabs" tab strip after Phase 2 migrates
 * `DockableTabBar.tsx` to use the shared <Tabs> component. Renders a
 * realistic mix of panel kinds (deployment, pod, configmap, logs,
 * diagnostics) using the exact configuration the Dockable wrapper will
 * use post-migration.
 *
 * This file PARALLELS the existing Dockable tab bar — it does not replace
 * it. The real migration (DockableTabBar.tsx) is Phase 2 and is
 * intentionally untouched here.
 *
 * Per the design doc, the Dockable wrapper's aria-label is literally
 * "Object Tabs" and the tab labels render in their natural case (no
 * uppercase transform, unlike the Object Panel preview).
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, type TabDescriptor, type TabsProps } from './';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';
// Import the real dockable panel CSS so the preview renders each tab's
// kind indicator via the production `.dockable-tab__kind-indicator.kind-badge`
// rules (which turn a `.kind-badge` into a 10x10 colored dot). That way
// this preview story exercises the same styling path the live app uses
// post-migration, rather than inline-styled spans.
import '../../../ui/dockable/DockablePanel.css';
import './stories.css';

// Lightweight action logger. The project doesn't install @storybook/addon-actions,
// so we log to the browser console instead — same pattern as Tabs.stories.tsx
// and ObjectPanelTabsPreview.stories.tsx.
const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[ObjectTabsPreview story] ${name}`, ...args);
  };

/**
 * Small wrapper that owns `activeId` state so the story can render the
 * fully-controlled <Tabs> without boilerplate. Wraps the strip in a
 * fixed-width viewport via the `tabs-story-viewport` class defined in
 * `stories.css` (the preview uses a real CSS class rather than an inline
 * style so the styling path matches production).
 */
interface TabsHarnessProps extends Omit<TabsProps, 'activeId' | 'onActivate'> {
  initialActiveId: string | null;
}

function TabsHarness({ initialActiveId, tabs, ...rest }: TabsHarnessProps) {
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const handleActivate = (id: string) => {
    logAction('onActivate')(id);
    setActiveId(id);
  };
  return (
    <div className="tabs-story-viewport">
      <Tabs {...rest} tabs={tabs} activeId={activeId} onActivate={handleActivate} />
    </div>
  );
}

// Dockable renders a small colored kind indicator in the `leading` slot
// for each resource tab. The indicator markup mirrors the live
// DockableTabBar exactly: a `<span>` with classes
// `dockable-tab__kind-indicator kind-badge <kind>` and `aria-hidden`. The
// `dockable-tab__kind-indicator.kind-badge` override in DockablePanel.css
// turns the badge into a 10x10 colored dot (via currentColor), and the
// kind-specific color class (e.g. `.kind-badge.deployment`) drives the
// final color from `styles/components/badges.css`. Tabs without a k8s
// kind (logs, diagnostics) omit the leading slot entirely, matching how
// the live DockableTabBar conditionally renders the indicator.
const kindIndicator = (kindClass: string) => (
  <span className={`dockable-tab__kind-indicator kind-badge ${kindClass}`} aria-hidden="true" />
);

// Tab descriptors using realistic Kubernetes resource paths so the preview
// reflects what Dockable labels actually look like in the real app. Each
// tab uses the production kind class for its leading indicator (colors
// come from `.kind-badge.<kind>` rules in `badges.css`). Tabs that aren't
// tied to a k8s kind (logs, diagnostics) omit the leading slot, matching
// the live DockableTabBar's conditional rendering of the indicator.
const DEPLOYMENT_TAB: TabDescriptor = {
  id: 'panel-deployment-nginx',
  label: 'deployment/nginx-frontend',
  leading: kindIndicator('deployment'),
  onClose: () => logAction('onClose')('panel-deployment-nginx'),
};
const POD_TAB: TabDescriptor = {
  id: 'panel-pod-api',
  label: 'pod/api-server-7d4f5b8c9-xkvm2',
  leading: kindIndicator('pod'),
  onClose: () => logAction('onClose')('panel-pod-api'),
};
const CONFIGMAP_TAB: TabDescriptor = {
  id: 'panel-configmap',
  label: 'configmap/app-config',
  leading: kindIndicator('configmap'),
  onClose: () => logAction('onClose')('panel-configmap'),
};
const LOGS_TAB: TabDescriptor = {
  id: 'panel-logs-api',
  label: 'logs: api-server',
  onClose: () => logAction('onClose')('panel-logs-api'),
};
const DIAGNOSTICS_TAB: TabDescriptor = {
  id: 'panel-diagnostics',
  label: 'diagnostics',
  onClose: () => logAction('onClose')('panel-diagnostics'),
};
const SERVICE_TAB: TabDescriptor = {
  id: 'panel-service-api',
  label: 'service/api-server',
  leading: kindIndicator('service'),
  onClose: () => logAction('onClose')('panel-service-api'),
};
const SECRET_TAB: TabDescriptor = {
  id: 'panel-secret-tls',
  label: 'secret/ingress-tls-cert',
  leading: kindIndicator('secret'),
  onClose: () => logAction('onClose')('panel-secret-tls'),
};
const INGRESS_TAB: TabDescriptor = {
  id: 'panel-ingress',
  label: 'ingress/public-gateway',
  leading: kindIndicator('ingress'),
  onClose: () => logAction('onClose')('panel-ingress'),
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
 * Object Tabs — preview of the Dockable tab strip after Phase 2 migration
 * to the shared <Tabs> component. Renders a realistic mix of panel kinds
 * (deployment, pod, configmap, logs, diagnostics) with kind-indicator dots
 * in the leading slot and close buttons on every tab. Configuration matches
 * the Dockable design doc: `aria-label="Object Tabs"`, no text transform
 * (natural case), default `'fit'` sizing, closeable tabs, leading kind dots.
 */
export const ObjectTabs: Story = {
  args: {
    'aria-label': 'Object Tabs',
    initialActiveId: 'panel-deployment-nginx',
    tabs: [
      DEPLOYMENT_TAB,
      POD_TAB,
      CONFIGMAP_TAB,
      LOGS_TAB,
      DIAGNOSTICS_TAB,
      SERVICE_TAB,
      SECRET_TAB,
      INGRESS_TAB,
    ],
  },
};
