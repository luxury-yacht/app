import { expect, it, vi } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';
import { requestPanelTabMove } from './panelTabActions';
import { type DockableTabDragPayload, objectPanelTabSnapshot } from './tabTransfer';

const request = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./index', () => ({ requestPanelTabTransfer: request }));
const tab = objectPanelTabSnapshot(
  'pod-a',
  {
    clusterId: 'production',
    group: '',
    version: 'v1',
    kind: 'Pod',
    namespace: 'default',
    name: 'a',
  },
  'yaml'
);
const payload: DockableTabDragPayload = {
  kind: 'dockable-tab',
  panelId: 'pod-a',
  sourceGroupId: 'right',
  sourceWindowGroupId: 'native-group',
  sourceWindowName: 'panel-1',
  clusterId: 'production',
  tab,
};

it.each(['right', 'bottom', 'floating'] as const)(
  'moves only the requested tab to %s without waiting for a publication',
  async (target) => {
    request.mockClear();
    await requestPanelTabMove(payload, target, '');
    expect(request).toHaveBeenCalledWith(
      'panel-1',
      expect.objectContaining({
        sourceWindowName: 'panel-1',
        sourceGroupId: 'native-group',
        targetWindowName: '',
        clusterId: 'production',
        targetKind: (target === 'floating'
          ? 'new-window'
          : 'workspace') as panelwindow.TabTransferTarget,
        tab,
      })
    );
    if (target !== 'floating') {
      expect(request.mock.calls[0]?.[1].targetGroupId).toBe(target);
    }
  }
);

it('rejects a tab without source identity', async () => {
  request.mockClear();
  await expect(
    requestPanelTabMove({ ...payload, sourceWindowName: undefined }, 'floating', '')
  ).rejects.toThrow('complete source');
  expect(request).not.toHaveBeenCalled();
});

it.each(['right', 'bottom', 'floating'] as const)(
  'keeps app-window dock destinations explicit for %s',
  async (target) => {
    request.mockClear();
    await requestPanelTabMove(
      { ...payload, sourceWindowName: 'workspace-1', sourceWindowGroupId: 'right' },
      target,
      'workspace-1'
    );
    expect(request).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ targetWindowName: target === 'floating' ? '' : 'workspace-1' })
    );
  }
);
