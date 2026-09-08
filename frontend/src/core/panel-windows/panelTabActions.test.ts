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
  'moves only the requested tab to %s after publication',
  async (target) => {
    request.mockClear();
    let release: () => void = () => undefined;
    const publication = {
      flush: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    const moving = requestPanelTabMove(payload, target, publication);
    expect(request).not.toHaveBeenCalled();
    release();
    await moving;
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

it('keeps a failed publication from starting a transfer', async () => {
  request.mockClear();
  await expect(
    requestPanelTabMove(payload, 'floating', {
      flush: async () => {
        throw new Error('publication failed');
      },
    })
  ).rejects.toThrow('publication failed');
  expect(request).not.toHaveBeenCalled();
});

it('rejects a tab without source identity before publishing', async () => {
  request.mockClear();
  const flush = vi.fn();
  await expect(
    requestPanelTabMove({ ...payload, sourceWindowName: undefined }, 'floating', { flush })
  ).rejects.toThrow('complete source');
  expect(flush).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
