import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';

const mocks = vi.hoisted(() => ({
  runtimeAvailable: vi.fn(() => true),
  onEvent: vi.fn(() => vi.fn()),
  backend: {
    GetNativeWindowDescriptor: vi.fn(),
    BeginPanelWindowOpen: vi.fn(),
    AcknowledgePanelWindowReady: vi.fn(),
    BeginPanelWindowDock: vi.fn(),
    AcknowledgePanelWindowDock: vi.fn(),
    FailPanelWindowTransfer: vi.fn(),
    FocusPanelWindow: vi.fn(),
    RequestPanelWindowClose: vi.fn(),
    AcknowledgePanelWindowClose: vi.fn(),
    RequestClosePanelWindowsForCluster: vi.fn(),
    AcknowledgeWorkspaceWindowClose: vi.fn(),
    RequestPanelWindowGuard: vi.fn(),
    AcknowledgePanelWindowGuard: vi.fn(),
    AcknowledgeApplicationQuitPreflight: vi.fn(),
    RoutePanelWindowCommand: vi.fn(),
    RequestPanelObjectOpen: vi.fn(),
    AuthorizePanelObjectOpen: vi.fn(),
    UpdatePanelWindowSnapshot: vi.fn(),
    RequestPanelTabClose: vi.fn(),
    AuthorizePanelTabClose: vi.fn(),
  },
}));

vi.mock('@/core/backend-api', () => mocks.backend);
vi.mock('@/core/desktop-runtime', () => ({
  desktopRuntimeAvailable: mocks.runtimeAvailable,
  onEvent: mocks.onEvent,
}));

import {
  acknowledgeApplicationQuitPreflight,
  acknowledgePanelWindowClose,
  acknowledgePanelWindowDock,
  acknowledgePanelWindowGuard,
  acknowledgePanelWindowReady,
  acknowledgeWorkspaceWindowClose,
  authorizePanelObjectOpen,
  authorizePanelTabClose,
  beginPanelWindowDock,
  beginPanelWindowOpen,
  failPanelWindowTransfer,
  focusPanelWindow,
  onApplicationQuitPreflightRequested,
  onOwnerCloseRequested,
  onPanelObjectOpenAuthorized,
  onPanelObjectOpenRequested,
  onPanelTabCloseAuthorized,
  onPanelTabCloseRequested,
  onPanelWindowClosed,
  onPanelWindowCloseRequested,
  onPanelWindowDockRequested,
  onPanelWindowFocusRequested,
  onPanelWindowGuardRequested,
  onPanelWindowGuardResult,
  onPanelWindowOpened,
  onPanelWindowSnapshotUpdated,
  requestClosePanelWindowsForCluster,
  requestPanelObjectOpen,
  requestPanelTabClose,
  requestPanelWindowClose,
  requestPanelWindowGuard,
  resolveNativeWindowDescriptor,
  routePanelWindowCommand,
  updatePanelWindowSnapshot,
} from './index';

const snapshot = {
  schemaVersion: 1,
  transferId: 'transfer-1',
  ownerWindowName: 'workspace-1',
  clusterId: 'cluster-1',
  groupId: 'group-1',
  tabs: [],
  activePanelId: 'panel-1',
} as panelwindow.GroupSnapshot;

const objectRef = {
  clusterId: 'cluster-1',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'api',
} as panelwindow.ObjectReference;

describe('native panel-window transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeAvailable.mockReturnValue(true);
    for (const command of Object.values(mocks.backend)) {
      command.mockResolvedValue(undefined);
    }
  });

  it('uses a workspace descriptor in a browser and validates native descriptors', async () => {
    mocks.runtimeAvailable.mockReturnValue(false);
    await expect(resolveNativeWindowDescriptor('workspace-1')).resolves.toEqual({
      schemaVersion: 1,
      role: 'workspace',
      workspace: { windowName: 'workspace-1' },
    });
    expect(mocks.backend.GetNativeWindowDescriptor).not.toHaveBeenCalled();

    mocks.runtimeAvailable.mockReturnValue(true);
    mocks.backend.GetNativeWindowDescriptor.mockResolvedValueOnce({
      schemaVersion: 1,
      role: 'panel',
      panel: { windowName: 'panel-1' },
    });
    await expect(resolveNativeWindowDescriptor('panel-1')).resolves.toMatchObject({
      role: 'panel',
    });

    mocks.backend.GetNativeWindowDescriptor.mockResolvedValueOnce({
      schemaVersion: 2,
      role: 'workspace',
      workspace: { windowName: 'workspace-1' },
    });
    await expect(resolveNativeWindowDescriptor('workspace-1')).rejects.toThrow(
      'Unsupported native window descriptor version 2'
    );

    mocks.backend.GetNativeWindowDescriptor.mockResolvedValueOnce({
      schemaVersion: 1,
      role: 'workspace',
      workspace: { windowName: 'workspace-other' },
    });
    await expect(resolveNativeWindowDescriptor('workspace-1')).rejects.toThrow(
      'Invalid native window descriptor'
    );
  });

  it('delegates every command with complete owner, cluster, and object identity', async () => {
    await beginPanelWindowOpen('workspace-1', snapshot);
    await acknowledgePanelWindowReady('panel-1', 'transfer-1');
    await beginPanelWindowDock('panel-1', 'right', snapshot);
    await acknowledgePanelWindowDock('workspace-1', 'panel-1', 'transfer-1');
    await failPanelWindowTransfer('workspace-1', 'panel-1', 'transfer-1');
    await focusPanelWindow('workspace-1', 'panel-1', 'panel-a');
    await requestPanelWindowClose('workspace-1', 'panel-1', 'owner-close');
    await acknowledgePanelWindowClose('panel-1');
    await requestClosePanelWindowsForCluster('workspace-1', 'cluster-1');
    await acknowledgeWorkspaceWindowClose('workspace-1');
    await requestPanelWindowGuard('workspace-1', 'panel-1', 'guard-1', 'application-quit');
    await acknowledgePanelWindowGuard('panel-1', 'guard-1', true);
    await acknowledgeApplicationQuitPreflight('workspace-1', 'quit-1', true);
    await routePanelWindowCommand('panel-1', 'open-settings');
    await requestPanelObjectOpen('panel-1', objectRef, 'details');
    await authorizePanelObjectOpen('workspace-1', 'panel-1', 'panel-a', objectRef, 'details');
    await updatePanelWindowSnapshot('panel-1', snapshot);
    await requestPanelTabClose('panel-1', 'panel-a');
    await authorizePanelTabClose('workspace-1', 'panel-1', 'panel-a');

    expect(mocks.backend.BeginPanelWindowOpen).toHaveBeenCalledWith('workspace-1', snapshot);
    expect(mocks.backend.AcknowledgePanelWindowReady).toHaveBeenCalledWith('panel-1', 'transfer-1');
    expect(mocks.backend.BeginPanelWindowDock).toHaveBeenCalledWith('panel-1', 'right', snapshot);
    expect(mocks.backend.AcknowledgePanelWindowDock).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'transfer-1'
    );
    expect(mocks.backend.FailPanelWindowTransfer).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'transfer-1'
    );
    expect(mocks.backend.FocusPanelWindow).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'panel-a'
    );
    expect(mocks.backend.RequestPanelWindowClose).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'owner-close'
    );
    expect(mocks.backend.AcknowledgePanelWindowClose).toHaveBeenCalledWith('panel-1');
    expect(mocks.backend.RequestClosePanelWindowsForCluster).toHaveBeenCalledWith(
      'workspace-1',
      'cluster-1'
    );
    expect(mocks.backend.AcknowledgeWorkspaceWindowClose).toHaveBeenCalledWith('workspace-1');
    expect(mocks.backend.RequestPanelWindowGuard).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'guard-1',
      'application-quit'
    );
    expect(mocks.backend.AcknowledgePanelWindowGuard).toHaveBeenCalledWith(
      'panel-1',
      'guard-1',
      true
    );
    expect(mocks.backend.AcknowledgeApplicationQuitPreflight).toHaveBeenCalledWith(
      'workspace-1',
      'quit-1',
      true
    );
    expect(mocks.backend.RoutePanelWindowCommand).toHaveBeenCalledWith('panel-1', 'open-settings');
    expect(mocks.backend.RequestPanelObjectOpen).toHaveBeenCalledWith(
      'panel-1',
      objectRef,
      'details'
    );
    expect(mocks.backend.AuthorizePanelObjectOpen).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'panel-a',
      objectRef,
      'details'
    );
    expect(mocks.backend.UpdatePanelWindowSnapshot).toHaveBeenCalledWith('panel-1', snapshot);
    expect(mocks.backend.RequestPanelTabClose).toHaveBeenCalledWith('panel-1', 'panel-a');
    expect(mocks.backend.AuthorizePanelTabClose).toHaveBeenCalledWith(
      'workspace-1',
      'panel-1',
      'panel-a'
    );
  });

  it('subscribes every role event through the desktop runtime', () => {
    const handler = vi.fn();
    const subscriptions = [
      [onPanelWindowOpened, 'panel-window:opened'],
      [onPanelWindowDockRequested, 'panel-window:dock-requested'],
      [onPanelWindowFocusRequested, 'panel-window:focus-requested'],
      [onPanelWindowCloseRequested, 'panel-window:close-requested'],
      [onPanelWindowClosed, 'panel-window:closed'],
      [onOwnerCloseRequested, 'panel-window:owner-close-requested'],
      [onPanelObjectOpenRequested, 'panel-window:object-open-requested'],
      [onPanelObjectOpenAuthorized, 'panel-window:object-open-authorized'],
      [onPanelWindowSnapshotUpdated, 'panel-window:snapshot-updated'],
      [onPanelTabCloseRequested, 'panel-window:tab-close-requested'],
      [onPanelTabCloseAuthorized, 'panel-window:tab-close-authorized'],
      [onApplicationQuitPreflightRequested, 'panel-window:application-quit-preflight-requested'],
      [onPanelWindowGuardRequested, 'panel-window:guard-requested'],
      [onPanelWindowGuardResult, 'panel-window:guard-result'],
    ] as const;

    for (const [subscribe] of subscriptions) {
      subscribe(handler as never);
    }
    expect(mocks.onEvent.mock.calls).toEqual(
      subscriptions.map(([, eventName]) => [eventName, handler])
    );
  });
});
