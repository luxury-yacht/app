import {
  AcceptClusterTabTransfer,
  AcceptPanelTabTransfer,
  AcknowledgeApplicationQuitPreflight,
  AcknowledgeClusterPanelClose,
  AcknowledgeClusterTabTransfer,
  AcknowledgePanelWindowClose,
  AcknowledgePanelWindowDock,
  AcknowledgePanelWindowReady,
  AcknowledgePanelWorkspaceReady,
  AcknowledgeWorkspaceWindowClose,
  BeginPanelWindowDock,
  BeginPanelWindowOpen,
  CloseClusterView,
  FailClusterTabTransfer,
  FailPanelTabTransfer,
  FailPanelWindowTransfer,
  FocusPanelWindow,
  GetNativeWindowDescriptor,
  OpenPanelWorkspaceObject,
  PublishDockedPanels,
  RequestClusterTabTransfer,
  RequestPanelTabClose,
  RequestPanelTabTransfer,
  RequestPanelWindowClose,
  UpdatePanelWindowSnapshot,
} from '@/core/backend-api';
import type { panelwindow } from '@/core/backend-api/models';
import { desktopRuntimeAvailable, onEvent } from '@/core/desktop-runtime';

export type NativeWindowDescriptor = panelwindow.NativeDescriptor;
export type PanelWindowDescriptor = panelwindow.WindowDescriptor;

export const openPanelWorkspaceObject = (windowName: string, tab: panelwindow.TabSnapshot) =>
  OpenPanelWorkspaceObject(windowName, tab);

export const publishDockedPanels = (windowName: string, groups: panelwindow.WorkspaceGroup[]) =>
  PublishDockedPanels(windowName, groups);

export const onPanelWorkspaceChanged = (
  handler: (event: panelwindow.WorkspaceChangedEvent) => void
) => onEvent('panel-workspace:changed', handler);

export const onPanelWorkspaceFocusRequested = (
  handler: (event: panelwindow.WorkspaceFocusRequestedEvent) => void
) => onEvent('panel-workspace:focus-requested', handler);

const workspaceDescriptor = (windowName: string): NativeWindowDescriptor => ({
  schemaVersion: 1,
  role: 'workspace' as panelwindow.NativeRole,
  workspace: { windowName },
});

export const resolveNativeWindowDescriptor = async (
  windowName: string
): Promise<NativeWindowDescriptor> => {
  if (!desktopRuntimeAvailable()) {
    return workspaceDescriptor(windowName);
  }
  const descriptor = await GetNativeWindowDescriptor(windowName);
  if (descriptor.schemaVersion !== 1) {
    throw new Error(`Unsupported native window descriptor version ${descriptor.schemaVersion}`);
  }
  if (descriptor.role === 'workspace' && descriptor.workspace?.windowName === windowName) {
    return descriptor;
  }
  if (descriptor.role === 'panel' && descriptor.panel?.windowName === windowName) {
    return descriptor;
  }
  throw new Error(`Invalid native window descriptor for ${windowName}`);
};

export const beginPanelWindowOpen = (
  callerWindowName: string,
  snapshot: panelwindow.GroupSnapshot
): Promise<PanelWindowDescriptor> => BeginPanelWindowOpen(callerWindowName, snapshot);

export const acknowledgePanelWindowReady = (
  windowName: string,
  transferId: string
): Promise<PanelWindowDescriptor> => AcknowledgePanelWindowReady(windowName, transferId);

export const beginPanelWindowDock = (
  windowName: string,
  targetPosition: 'right' | 'bottom',
  snapshot: panelwindow.GroupSnapshot
): Promise<void> => BeginPanelWindowDock(windowName, targetPosition, snapshot);

export const acknowledgePanelWindowDock = (
  callerWindowName: string,
  windowName: string,
  transferId: string
): Promise<void> => AcknowledgePanelWindowDock(callerWindowName, windowName, transferId);

export const failPanelWindowTransfer = (
  callerWindowName: string,
  windowName: string,
  transferId: string
): Promise<void> => FailPanelWindowTransfer(callerWindowName, windowName, transferId);

export const focusPanelWindow = (
  callerWindowName: string,
  windowName: string,
  panelId: string
): Promise<void> => FocusPanelWindow(callerWindowName, windowName, panelId);

export const requestPanelWindowClose = (
  callerWindowName: string,
  windowName: string,
  reason: string
): Promise<void> => RequestPanelWindowClose(callerWindowName, windowName, reason);

export const acknowledgePanelWindowClose = (windowName: string): Promise<void> =>
  AcknowledgePanelWindowClose(windowName);

export const acknowledgeWorkspaceWindowClose = (callerWindowName: string): Promise<void> =>
  AcknowledgeWorkspaceWindowClose(callerWindowName);

export const acknowledgeApplicationQuitPreflight = (
  callerWindowName: string,
  transactionId: string,
  allowed: boolean
): Promise<void> => AcknowledgeApplicationQuitPreflight(callerWindowName, transactionId, allowed);

export const updatePanelWindowSnapshot = (
  windowName: string,
  snapshot: panelwindow.GroupSnapshot
): Promise<void> => UpdatePanelWindowSnapshot(windowName, snapshot);

export const requestPanelTabClose = (windowName: string, panelId: string): Promise<void> =>
  RequestPanelTabClose(windowName, panelId);

export const requestPanelTabTransfer = (
  callerWindowName: string,
  request: panelwindow.TabTransferRequest
): Promise<void> => RequestPanelTabTransfer(callerWindowName, request);

export const acceptPanelTabTransfer = (
  callerWindowName: string,
  transferId: string
): Promise<void> => AcceptPanelTabTransfer(callerWindowName, transferId);

export const failPanelTabTransfer = (callerWindowName: string, transferId: string): Promise<void> =>
  FailPanelTabTransfer(callerWindowName, transferId);

export const onPanelWindowOpened = (handler: (event: panelwindow.WindowOpenedEvent) => void) =>
  onEvent('panel-window:opened', handler);

export const onPanelWindowDockRequested = (
  handler: (event: panelwindow.WindowDockRequestedEvent) => void
) => onEvent('panel-window:dock-requested', handler);

export const onPanelWindowFocusRequested = (
  handler: (event: panelwindow.WindowFocusRequestedEvent) => void
) => onEvent('panel-window:focus-requested', handler);

export const onPanelWindowCloseRequested = (
  handler: (event: panelwindow.WindowCloseRequestedEvent) => void
) => onEvent('panel-window:close-requested', handler);

export const onPanelWindowClosed = (handler: (event: panelwindow.WindowClosedEvent) => void) =>
  onEvent('panel-window:closed', handler);

export const onWorkspaceCloseRequested = (
  handler: (event: panelwindow.WorkspaceCloseRequestedEvent) => void
) => onEvent('workspace-window:close-requested', handler);

export const onPanelTabCloseAuthorized = (
  handler: (event: panelwindow.TabCloseAuthorizedEvent) => void
) => onEvent('panel-window:tab-close-authorized', handler);

export const onPanelTabTransferRequested = (
  handler: (event: panelwindow.TabTransferRequestedEvent) => void
) => onEvent('panel-window:tab-transfer-requested', handler);

export const onPanelTabTransferInsertRequested = (
  handler: (event: panelwindow.TabTransferInsertRequestedEvent) => void
) => onEvent('panel-window:tab-transfer-insert-requested', handler);

export const onPanelTabTransferCommitted = (
  handler: (event: panelwindow.TabTransferCommittedEvent) => void
) => onEvent('panel-window:tab-transfer-committed', handler);

export const onPanelTabTransferFailed = (
  handler: (event: panelwindow.TabTransferFailedEvent) => void
) => onEvent('panel-window:tab-transfer-failed', handler);

export const onApplicationQuitPreflightRequested = (
  handler: (event: panelwindow.ApplicationQuitPreflightRequestedEvent) => void
) => onEvent('panel-window:application-quit-preflight-requested', handler);

export const onApplicationQuitPreflightSettled = (
  handler: (event: panelwindow.ApplicationQuitPreflightRequestedEvent) => void
) => onEvent('panel-window:application-quit-preflight-settled', handler);

export const acknowledgePanelWorkspaceReady = (windowName: string) =>
  AcknowledgePanelWorkspaceReady(windowName);

export const requestClusterTabTransfer = (
  windowName: string,
  request: panelwindow.ClusterTabTransferRequest
) => RequestClusterTabTransfer(windowName, request);
export const acceptClusterTabTransfer = (
  windowName: string,
  transferId: string,
  snapshot: panelwindow.ClusterViewSnapshot
) => AcceptClusterTabTransfer(windowName, transferId, snapshot);
export const acknowledgeClusterTabTransfer = (windowName: string, transferId: string) =>
  AcknowledgeClusterTabTransfer(windowName, transferId);
export const failClusterTabTransfer = (windowName: string, transferId: string) =>
  FailClusterTabTransfer(windowName, transferId);
export const onClusterTabTransferRequested = (
  handler: (event: panelwindow.ClusterTabTransferEvent) => void
) => onEvent('cluster-tab-transfer:requested', handler);
export const onClusterTabTransferInsert = (
  handler: (event: panelwindow.ClusterTabTransferEvent) => void
) => onEvent('cluster-tab-transfer:insert', handler);
export const onClusterTabTransferCommitted = (
  handler: (event: panelwindow.ClusterTabTransferEvent) => void
) => onEvent('cluster-tab-transfer:committed', handler);
export const onClusterTabTransferFailed = (
  handler: (event: panelwindow.ClusterTabTransferEvent) => void
) => onEvent('cluster-tab-transfer:failed', handler);

export const onPanelWindowTransferFailed = (
  handler: (event: panelwindow.WindowTransferFailedEvent) => void
) => onEvent('panel-window:transfer-failed', handler);

export const closeClusterView = (windowName: string, clusterId: string): Promise<boolean> =>
  CloseClusterView(windowName, clusterId);
export const acknowledgeClusterPanelClose = (
  windowName: string,
  transactionId: string,
  allowed: boolean
): Promise<void> => AcknowledgeClusterPanelClose(windowName, transactionId, allowed);
export const onClusterPanelCloseRequested = (
  handler: (event: panelwindow.ClusterPanelCloseEvent) => void
) => onEvent('cluster-panel-close:requested', handler);
export const onClusterPanelCloseSettled = (
  handler: (event: panelwindow.ClusterPanelCloseEvent) => void
) => onEvent('cluster-panel-close:settled', handler);
