/**
 * frontend/src/modules/object-panel/pods-panel/PodsPanel.test.tsx
 *
 * The Pods dock tab: one workload's or node's pods in a standard dock tab.
 */

import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type { TabGroupState } from '@ui/dockable/tabGroupTypes';
import type { ReactNode } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireValue } from '@/test-utils/requireValue';
import type { PodsPanelTarget } from '../contexts/PodsPanelStateContext';
import { useCurrentObjectPanel } from '../hooks/useObjectPanel';
import PodsPanel from './PodsPanel';

const mocks = vi.hoisted(() => ({
  dockProps: null as null | {
    panelId: string;
    title?: string;
    defaultPosition?: string;
    onClose?: () => void;
  },
  podsTab: null as null | { isActive: boolean; objectName?: string; objectKind?: string },
  switchTab: vi.fn(),
  tabGroups: null as unknown as TabGroupState,
}));

vi.mock('@ui/dockable', () => ({
  useDockablePanelContext: () => ({ tabGroups: mocks.tabGroups, switchTab: mocks.switchTab }),
  DockablePanel: (props: {
    panelId: string;
    title?: string;
    defaultPosition?: string;
    onClose?: () => void;
    children: ReactNode;
  }) => {
    mocks.dockProps = props;
    return <div>{props.children}</div>;
  },
}));
vi.mock('@/core/panel-windows/panelLifecycleGuards', () => ({
  PanelLifecycleClusterSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../components/ObjectPanel/Pods/PodsTab', () => ({
  PodsTab: ({ isActive }: { isActive: boolean }) => {
    const { objectData } = useCurrentObjectPanel();
    mocks.podsTab = { isActive, objectName: objectData?.name, objectKind: objectData?.kind };
    return null;
  },
}));

const panelId = 'pods:alpha:ctx';
const deployment = buildRequiredObjectReference(
  makeResourceRef({
    group: 'apps',
    kind: 'Deployment',
    resource: 'deployments',
    namespace: 'team-a',
    name: 'api',
  })
);
const target = (request: number): PodsPanelTarget => ({
  object: deployment,
  source: 'workloads',
  request,
});
const bottomGroup = (activeTab: string): TabGroupState => ({
  right: { tabs: [], activeTab: null },
  bottom: { tabs: ['app-logs', panelId], activeTab },
  floating: [],
});

describe('PodsPanel', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const onClose = vi.fn();
  const render = (request: number) =>
    act(() => {
      root.render(<PodsPanel target={target(request)} onClose={onClose} />);
    });

  beforeEach(() => {
    mocks.dockProps = null;
    mocks.podsTab = null;
    mocks.switchTab.mockReset();
    mocks.tabGroups = bottomGroup(panelId);
    onClose.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows the target’s pods in a cluster-scoped "Pods · name" tab that opens at the bottom', () => {
    render(1);

    const dock = requireValue(mocks.dockProps, 'expected the dock tab');
    expect(dock).toMatchObject({ panelId, title: 'Pods · api', defaultPosition: 'bottom' });
    expect(mocks.podsTab).toEqual({ isActive: true, objectName: 'api', objectKind: 'Deployment' });

    act(() => dock.onClose?.());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('pauses the pods query while another tab is in front of it', () => {
    mocks.tabGroups = bottomGroup('app-logs');
    render(1);

    expect(mocks.podsTab?.isActive).toBe(false);
  });

  it('brings itself to the front for each new request without taking keyboard focus', () => {
    mocks.tabGroups = bottomGroup('app-logs');
    render(1);
    expect(mocks.switchTab).not.toHaveBeenCalled();

    render(2);

    expect(mocks.switchTab).toHaveBeenCalledWith('bottom', panelId);
  });
});
