import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';
import {
  ObjectPanelStateProvider,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import { requireValue } from '@/test-utils/requireValue';
import { DockablePanelProvider, useDockablePanelContext } from '@/ui/dockable';
import type { PanelLayoutStore } from '@/ui/dockable/panelLayoutStore';
import { usePanelLayoutStoreContext } from '@/ui/dockable/panelLayoutStoreContext';
import { PanelLayoutLifecycle } from './PanelLayoutLifecycle';
import { useRestoreWorkspacePanels } from './useRestoreWorkspacePanels';

const selection = vi.hoisted(() => ({ active: 'cluster-a', ids: ['cluster-a', 'cluster-b'] }));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: selection.active,
    selectedClusterIds: selection.ids,
  }),
}));
vi.mock('@/core/data-access', () => ({ resetRefreshDomain: vi.fn() }));

it('restores groups before content and cleans an inactive cluster without touching the active cluster', async () => {
  const stores = new Map<string, PanelLayoutStore>();
  let objects: ReturnType<typeof useObjectPanelState> | undefined;
  let dockable: ReturnType<typeof useDockablePanelContext> | undefined;
  let restore: ReturnType<typeof useRestoreWorkspacePanels>;
  const committed: Array<{ cluster: string; panels: string[]; bottom: string[] }> = [];
  const Probe = () => {
    const objectState = useObjectPanelState();
    objects = objectState;
    const dockState = useDockablePanelContext();
    dockable = dockState;
    restore = useRestoreWorkspacePanels();
    stores.set(selection.active, usePanelLayoutStoreContext());
    useLayoutEffect(() => {
      committed.push({
        cluster: selection.active,
        panels: [...objectState.openPanels.keys()],
        bottom: dockState.tabGroups.bottom.tabs,
      });
    });
    return null;
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = async () =>
    act(async () =>
      root.render(
        <ObjectPanelStateProvider>
          <DockablePanelProvider>
            <PanelLayoutLifecycle />
            <Probe />
          </DockablePanelProvider>
        </ObjectPanelStateProvider>
      )
    );
  const group = (clusterId: string): panelwindow.WorkspaceGroup => {
    const objectRef = {
      clusterId,
      group: '',
      version: 'v1',
      kind: 'ConfigMap',
      namespace: 'default',
      name: 'settings',
    };
    const panelId = objectPanelId(objectRef);
    return {
      clusterId,
      groupId: 'bottom',
      activePanelId: panelId,
      tabs: [{ kind: 'object' as panelwindow.TabKind, panelId, objectRef, activeView: 'yaml' }],
    };
  };
  const first = group('cluster-a');
  const second = group('cluster-b');
  try {
    await render();
    await act(async () => restore(first, 'bottom'));
    const firstStore = requireValue(stores.get('cluster-a'), 'cluster-a layout exists');
    firstStore.updateState(first.activePanelId, {
      bottomSize: { width: 400, height: 540 },
      isOpen: true,
    });
    expect(
      requireValue(objects, 'object state is mounted').getOwnedPanel(
        'cluster-a',
        first.activePanelId
      )?.activeView
    ).toBe('yaml');
    expect(
      committed
        .filter((visit) => visit.panels.includes(first.activePanelId))
        .every((visit) => visit.bottom.includes(first.activePanelId))
    ).toBe(true);
    selection.active = 'cluster-b';
    await render();
    await act(async () => restore(second, 'bottom'));
    const secondStore = requireValue(stores.get('cluster-b'), 'cluster-b layout exists');
    secondStore.updateState(second.activePanelId, {
      bottomSize: { width: 400, height: 360 },
      isOpen: true,
    });
    expect(firstStore.getState(first.activePanelId)?.bottomSize.height).toBe(540);
    await act(async () =>
      requireValue(objects, 'object state is mounted').closePanel('cluster-a', first.activePanelId)
    );
    expect(firstStore.getState(first.activePanelId)).toBeUndefined();
    expect(
      requireValue(dockable, 'layout context is mounted').getClusterTabGroups('cluster-a').bottom
        .tabs
    ).toEqual([]);
    expect(secondStore.getState(second.activePanelId)?.bottomSize.height).toBe(360);
    expect(requireValue(dockable, 'layout context is mounted').tabGroups.bottom.tabs).toEqual([
      second.activePanelId,
    ]);
    expect(
      requireValue(objects, 'object state is mounted').getOwnedPanel(
        'cluster-b',
        second.activePanelId
      )?.objectRef.clusterId
    ).toBe('cluster-b');
    await act(async () =>
      requireValue(objects, 'object state is mounted').removeOwnedPanel(
        'cluster-b',
        second.activePanelId
      )
    );
    expect(secondStore.getState(second.activePanelId)).toBeUndefined();
    expect(requireValue(dockable, 'layout context is mounted').tabGroups.bottom.tabs).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    selection.active = 'cluster-a';
  }
});
