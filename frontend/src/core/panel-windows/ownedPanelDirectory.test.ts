import { describe, expect, it } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';
import {
  addDockedObjectPanel,
  beginNativePanelOpen,
  commitNativePanelOpen,
  createOwnedPanelDirectory,
  rollbackNativePanelOpen,
} from './ownedPanelDirectory';

const objectRef = (clusterId: string, name: string): panelwindow.ObjectReference => ({
  clusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'default',
  name,
});

describe('owner panel directory', () => {
  it('keeps the source docked until native readiness commits the transfer', () => {
    let directory = createOwnedPanelDirectory();
    directory = addDockedObjectPanel(directory, {
      panelId: 'panel-a',
      objectRef: objectRef('cluster-a', 'api'),
      activeView: 'details',
      edge: 'right',
    });

    directory = beginNativePanelOpen(directory, {
      schemaVersion: 1,
      transferId: 'transfer-a',
      ownerWindowName: 'main',
      clusterId: 'cluster-a',
      groupId: 'group-a',
      tabs: [
        {
          kind: 'object' as panelwindow.TabKind,
          panelId: 'panel-a',
          objectRef: objectRef('cluster-a', 'api'),
          activeView: 'yaml',
        },
      ],
      activePanelId: 'panel-a',
    });

    expect(directory.get('cluster-a')?.panels.get('panel-a')?.location).toEqual({
      kind: 'pending-window',
      edge: 'right',
      transferId: 'transfer-a',
      groupId: 'group-a',
    });

    directory = commitNativePanelOpen(directory, {
      transferId: 'transfer-a',
      windowName: 'panel-1',
      clusterId: 'cluster-a',
      groupId: 'group-a',
    });
    expect(directory.get('cluster-a')?.panels.get('panel-a')?.location).toEqual({
      kind: 'panel-window',
      windowName: 'panel-1',
      groupId: 'group-a',
    });
  });

  it('rolls back only the matching cluster transfer', () => {
    let directory = createOwnedPanelDirectory();
    directory = addDockedObjectPanel(directory, {
      panelId: 'panel-a',
      objectRef: objectRef('cluster-a', 'api'),
      activeView: 'details',
      edge: 'bottom',
    });
    directory = addDockedObjectPanel(directory, {
      panelId: 'panel-b',
      objectRef: objectRef('cluster-b', 'api'),
      activeView: 'details',
      edge: 'right',
    });
    directory = beginNativePanelOpen(directory, {
      schemaVersion: 1,
      transferId: 'transfer-a',
      ownerWindowName: 'main',
      clusterId: 'cluster-a',
      groupId: 'group-a',
      tabs: [
        {
          kind: 'object' as panelwindow.TabKind,
          panelId: 'panel-a',
          objectRef: objectRef('cluster-a', 'api'),
          activeView: 'details',
        },
      ],
      activePanelId: 'panel-a',
    });

    directory = rollbackNativePanelOpen(directory, 'cluster-a', 'transfer-a');

    expect(directory.get('cluster-a')?.panels.get('panel-a')?.location).toEqual({
      kind: 'docked',
      edge: 'bottom',
    });
    expect(directory.get('cluster-b')?.panels.get('panel-b')?.location).toEqual({
      kind: 'docked',
      edge: 'right',
    });
  });
});
