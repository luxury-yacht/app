/**
 * frontend/src/ui/dockable/appWidePanelClusterSwitch.test.tsx
 *
 * App-wide panels (Diagnostics) keep their open flag outside the per-cluster
 * dock layout. Switching cluster tabs must not hide one the user has open.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
import DockablePanel from './DockablePanel';
import { DockablePanelProvider } from './DockablePanelProvider';

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: vi.fn(),
}));
vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

const selectCluster = (clusterId: string) => {
  vi.mocked(useKubeconfig).mockReturnValue({
    selectedClusterId: clusterId,
    managedClusterIds: ['cluster-a', 'cluster-b'],
  } as unknown as ReturnType<typeof useKubeconfig>);
};

describe('app-wide dockable panels across cluster tabs', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const draw = async (isOpen: boolean) => {
    await act(async () => {
      root.render(
        <ZoomProvider>
          <TabDragProvider>
            <DockablePanelProvider>
              <DockablePanelTestHost />
              <DockablePanel panelId="diagnostics" title="Diagnostics" isOpen={isOpen}>
                <div data-testid="diagnostics-body" />
              </DockablePanel>
            </DockablePanelProvider>
          </TabDragProvider>
        </ZoomProvider>
      );
    });
    // Registration, group sync, and the content host settle over a few passes.
    for (let pass = 0; pass < 3; pass += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  const diagnosticsVisible = () =>
    Boolean(document.querySelector('[data-testid="diagnostics-body"]'));

  beforeEach(() => {
    const content = document.createElement('div');
    content.className = 'content';
    const body = document.createElement('div');
    body.className = 'content-body';
    content.appendChild(body);
    document.body.appendChild(content);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    vi.clearAllMocks();
  });

  it('stays open when the user switches to a cluster tab visited before it opened', async () => {
    // Both tabs are visited while the panel is closed, as when two clusters
    // are open before the user opens Diagnostics.
    selectCluster('cluster-a');
    await draw(false);
    selectCluster('cluster-b');
    await draw(false);
    selectCluster('cluster-a');
    await draw(false);

    await draw(true);
    expect(diagnosticsVisible()).toBe(true);

    selectCluster('cluster-b');
    await draw(true);
    expect(diagnosticsVisible()).toBe(true);
  });

  it('stays closed on every cluster tab once the user closes it', async () => {
    selectCluster('cluster-a');
    await draw(true);
    selectCluster('cluster-b');
    await draw(true);
    expect(diagnosticsVisible()).toBe(true);

    await draw(false);
    selectCluster('cluster-a');
    await draw(false);
    expect(diagnosticsVisible()).toBe(false);
  });
});
