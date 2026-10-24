/**
 * frontend/src/core/panel-windows/panelTabActions.test.ts
 *
 * A dock move becomes one panel-tab transfer request to the backend. The
 * request goes through the real panel-window client to the faked backend
 * (test-utils/appState); no window is mounted.
 */

import { beforeEach, expect, it } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { requestPanelTabMove } from './panelTabActions';
import { type DockableTabDragPayload, objectPanelTabSnapshot } from './tabTransfer';

const app = installAppStateHarness();
const requests = () => app.backend.calls('RequestPanelTabTransfer');

beforeEach(() => {
  app.backend.answer('RequestPanelTabTransfer', () => undefined);
});
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
    await requestPanelTabMove(payload, target, '');
    expect(requests()).toEqual([
      [
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
        }),
      ],
    ]);
    if (target !== 'floating') {
      expect(requests()[0]?.[1].targetGroupId).toBe(target);
    }
  }
);

it('rejects a tab without source identity', async () => {
  await expect(
    requestPanelTabMove({ ...payload, sourceWindowName: undefined }, 'floating', '')
  ).rejects.toThrow('complete source');
  expect(requests()).toEqual([]);
});

it.each(['right', 'bottom', 'floating'] as const)(
  'keeps app-window dock destinations explicit for %s',
  async (target) => {
    await requestPanelTabMove(
      { ...payload, sourceWindowName: 'workspace-1', sourceWindowGroupId: 'right' },
      target,
      'workspace-1'
    );
    expect(requests()).toEqual([
      [
        'workspace-1',
        expect.objectContaining({ targetWindowName: target === 'floating' ? '' : 'workspace-1' }),
      ],
    ]);
  }
);
