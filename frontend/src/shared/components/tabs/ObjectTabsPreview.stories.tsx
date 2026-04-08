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
    console.log(`[ObjectTabsPreview story] ${name}`, ...args);
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

// Constrain the width to roughly a real Dockable column so the strip renders
// in context instead of stretching to fill the Storybook canvas. The strip
// brings its own background and bottom border via tabs.css; we don't add any
// chrome of our own.
const panelWrapperStyle: CSSProperties = {
  width: 600,
};

// Dockable uses a small colored dot in the `leading` slot to indicate the
// kind of resource each panel represents. For the preview we use plain
// inline-styled spans so the story doesn't depend on any kind-badge CSS.
const kindDot = (color: string) => (
  <span
    style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }}
  />
);

// Tab descriptors using realistic Kubernetes resource paths so the preview
// reflects what Dockable labels actually look like in the real app. Mix of
// kinds (deployment, pod, configmap, logs, diagnostics) with distinct
// colors so the variety is visible at a glance.
const DEPLOYMENT_TAB: TabDescriptor = {
  id: 'panel-deployment-nginx',
  label: 'deployment/nginx-frontend',
  leading: kindDot('#3b82f6'),
  onClose: () => logAction('onClose')('panel-deployment-nginx'),
};
const POD_TAB: TabDescriptor = {
  id: 'panel-pod-api',
  label: 'pod/api-server-7d4f5b8c9-xkvm2',
  leading: kindDot('#10b981'),
  onClose: () => logAction('onClose')('panel-pod-api'),
};
const CONFIGMAP_TAB: TabDescriptor = {
  id: 'panel-configmap',
  label: 'configmap/app-config',
  leading: kindDot('#f59e0b'),
  onClose: () => logAction('onClose')('panel-configmap'),
};
const LOGS_TAB: TabDescriptor = {
  id: 'panel-logs-api',
  label: 'logs: api-server',
  leading: kindDot('#8b5cf6'),
  onClose: () => logAction('onClose')('panel-logs-api'),
};
const DIAGNOSTICS_TAB: TabDescriptor = {
  id: 'panel-diagnostics',
  label: 'diagnostics',
  leading: kindDot('#6b7280'),
  onClose: () => logAction('onClose')('panel-diagnostics'),
};
const SERVICE_TAB: TabDescriptor = {
  id: 'panel-service-api',
  label: 'service/api-server',
  leading: kindDot('#ec4899'),
  onClose: () => logAction('onClose')('panel-service-api'),
};
const SECRET_TAB: TabDescriptor = {
  id: 'panel-secret-tls',
  label: 'secret/ingress-tls-cert',
  leading: kindDot('#ef4444'),
  onClose: () => logAction('onClose')('panel-secret-tls'),
};
const INGRESS_TAB: TabDescriptor = {
  id: 'panel-ingress',
  label: 'ingress/public-gateway',
  leading: kindDot('#14b8a6'),
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
    wrapperStyle: panelWrapperStyle,
  },
};
