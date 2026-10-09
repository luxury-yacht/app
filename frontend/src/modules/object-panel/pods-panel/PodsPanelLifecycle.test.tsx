/**
 * frontend/src/modules/object-panel/pods-panel/PodsPanelLifecycle.test.tsx
 *
 * The Pods dock tab reuses one panel id per cluster, so closing it must not
 * leave dock state behind that keeps the next row click from reopening it.
 * Runs the real dock provider, host, tab, and state; only the pods table is
 * substituted.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { KeyboardProvider } from '@ui/shortcuts/context';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelLifecycleGuardProvider } from '@/core/panel-windows/panelLifecycleGuards';
import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import DockablePanel from '@/ui/dockable/DockablePanel';
import {
  DockablePanelProvider,
  useDockablePanelContext,
} from '@/ui/dockable/DockablePanelProvider';
import {
  PodsPanelStateProvider,
  type PodsPanelStateValue,
  useOptionalPodsPanelState,
} from '../contexts/PodsPanelStateContext';
import { PodsPanelHost } from './PodsPanelHost';

vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/errorHandler', () => ({ errorHandler: { warn: vi.fn(), handle: vi.fn() } }));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'alpha:ctx', managedClusterIds: ['alpha:ctx'] }),
}));
vi.mock('../components/ObjectPanel/ObjectPanelHeader', () => ({
  ObjectPanelHeader: () => null,
}));
vi.mock('../components/ObjectPanel/Pods/PodsTab', () => ({
  PodsTab: () => {
    const { objectData } = useCurrentObjectPanel();
    return <div data-testid="pods-content">{objectData?.name}</div>;
  },
}));

import { useCurrentObjectPanel } from '../hooks/useObjectPanel';

const podsTabId = 'pods:alpha:ctx';
const deployment = (name: string) =>
  buildRequiredObjectReference(
    makeResourceRef({
      group: 'apps',
      kind: 'Deployment',
      resource: 'deployments',
      namespace: 'team-a',
      name,
    })
  );

let dock: ReturnType<typeof useDockablePanelContext> | null = null;
let podsTab: PodsPanelStateValue | null = null;
const Probe = () => {
  dock = useDockablePanelContext();
  podsTab = useOptionalPodsPanelState();
  return null;
};

/** The object name the Pods tab shows, or null when it is not on screen. */
const shownPods = () => {
  const content = document.querySelector('[data-testid="pods-content"]');
  return content && !content.closest('[hidden]') ? content.textContent : null;
};
const groupsHoldingPodsTab = () =>
  (['right', 'bottom'] as const).filter((key) => dock?.tabGroups[key].tabs.includes(podsTabId));

describe('Pods dock tab lifecycle', () => {
  let root: ReactDOM.Root;
  let host: HTMLDivElement;
  let content: HTMLDivElement;

  const render = (otherPanel: React.ReactNode = null) =>
    act(async () => {
      root.render(
        <KeyboardProvider>
          <PanelLifecycleGuardProvider>
            <DockablePanelProvider>
              <ZoomProvider>
                <PodsPanelStateProvider>
                  <DockablePanelTestHost />
                  <Probe />
                  <PodsPanelHost />
                  {otherPanel}
                </PodsPanelStateProvider>
              </ZoomProvider>
            </DockablePanelProvider>
          </PanelLifecycleGuardProvider>
        </KeyboardProvider>
      );
    });
  const showPods = async (name: string) => {
    await act(async () => podsTab?.show(deployment(name), 'workloads'));
    // The tab module loads lazily; wait for it to show this object's pods.
    await vi.waitFor(() => {
      if (shownPods() !== name) {
        throw new Error(`Pods tab shows ${shownPods() ?? 'nothing'}, expected ${name}`);
      }
    });
  };

  beforeEach(() => {
    content = document.createElement('div');
    content.className = 'content';
    const body = document.createElement('div');
    body.className = 'content-body';
    content.appendChild(body);
    content.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 });
    document.body.appendChild(content);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = ReactDOM.createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    content.remove();
  });

  it('reopens on the next row click after the dock closed it with another panel', async () => {
    // Another panel shares the bottom dock; the dock's close control closes every tab in it.
    const otherPanel = (
      <DockablePanel
        panelId="obj:alpha:ctx:apps/v1/deployment:team-a:web"
        title="web"
        isOpen
        defaultPosition="bottom"
        defaultGroupKey="bottom"
      >
        <div />
      </DockablePanel>
    );
    await render(otherPanel);
    await showPods('api');
    await act(async () => {
      for (const id of [...(dock?.tabGroups.bottom.tabs ?? [])]) {
        dock?.closeTab(id);
      }
    });
    expect(shownPods()).toBeNull();

    await showPods('web');

    expect(groupsHoldingPodsTab()).toEqual(['bottom']);
  });

  it('leaves no dock tab behind when the app closes it, and reopens on the next row click', async () => {
    await render();
    await showPods('api');

    // Turning Show Pods off closes the tab through state, not the dock.
    await act(async () => podsTab?.closeSource('workloads'));

    expect(shownPods()).toBeNull();
    expect(groupsHoldingPodsTab()).toEqual([]);
    await showPods('web');
    expect(groupsHoldingPodsTab()).toEqual(['bottom']);
  });
});
