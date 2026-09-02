import {
  AcceptPanelTabTransfer,
  AcknowledgeApplicationQuitPreflight,
  AcknowledgePanelWindowClose,
  AcknowledgePanelWindowDock,
  AcknowledgePanelWindowGuard,
  AcknowledgePanelWindowReady,
  AcknowledgeWorkspaceWindowClose,
  AuthorizePanelObjectOpen,
  AuthorizePanelTabClose,
  BeginPanelWindowDock,
  BeginPanelWindowOpen,
  FailPanelTabTransfer,
  FailPanelWindowTransfer,
  FocusPanelWindow,
  GetNativeWindowDescriptor,
  RequestPanelObjectOpen,
  RequestPanelTabClose,
  RequestPanelTabTransfer,
  RequestPanelWindowClose,
  RequestPanelWindowGuard,
  RoutePanelWindowCommand,
  UpdatePanelWindowSnapshot,
} from '@/core/backend-api';
import type { panelwindow } from '@/core/backend-api/models';
import { desktopRuntimeAvailable, onEvent } from '@/core/desktop-runtime';

export type NativeWindowDescriptor = panelwindow.NativeDescriptor;
export type PanelWindowDescriptor = panelwindow.WindowDescriptor;

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
  ownerWindowName: string,
  snapshot: panelwindow.GroupSnapshot
): Promise<PanelWindowDescriptor> => BeginPanelWindowOpen(ownerWindowName, snapshot);

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
  ownerWindowName: string,
  windowName: string,
  transferId: string
): Promise<void> => AcknowledgePanelWindowDock(ownerWindowName, windowName, transferId);

export const failPanelWindowTransfer = (
  callerWindowName: string,
  windowName: string,
  transferId: string
): Promise<void> => FailPanelWindowTransfer(callerWindowName, windowName, transferId);

export const focusPanelWindow = (
  ownerWindowName: string,
  windowName: string,
  panelId: string
): Promise<void> => FocusPanelWindow(ownerWindowName, windowName, panelId);

export const requestPanelWindowClose = (
  callerWindowName: string,
  windowName: string,
  reason: string
): Promise<void> => RequestPanelWindowClose(callerWindowName, windowName, reason);

export const acknowledgePanelWindowClose = (windowName: string): Promise<void> =>
  AcknowledgePanelWindowClose(windowName);

export const acknowledgeWorkspaceWindowClose = (ownerWindowName: string): Promise<void> =>
  AcknowledgeWorkspaceWindowClose(ownerWindowName);

export const requestPanelWindowGuard = (
  ownerWindowName: string,
  windowName: string,
  requestId: string,
  reason: string
): Promise<void> => RequestPanelWindowGuard(ownerWindowName, windowName, requestId, reason);

export const acknowledgePanelWindowGuard = (
  windowName: string,
  requestId: string,
  allowed: boolean
): Promise<void> => AcknowledgePanelWindowGuard(windowName, requestId, allowed);

export const acknowledgeApplicationQuitPreflight = (
  ownerWindowName: string,
  transactionId: string,
  allowed: boolean
): Promise<void> => AcknowledgeApplicationQuitPreflight(ownerWindowName, transactionId, allowed);

export const routePanelWindowCommand = (windowName: string, eventName: string): Promise<void> =>
  RoutePanelWindowCommand(windowName, eventName);

export const requestPanelObjectOpen = (
  windowName: string,
  objectRef: panelwindow.ObjectReference,
  activeView: string
): Promise<void> => RequestPanelObjectOpen(windowName, objectRef, activeView);

export const authorizePanelObjectOpen = (
  ownerWindowName: string,
  windowName: string,
  panelId: string,
  objectRef: panelwindow.ObjectReference,
  activeView: string
): Promise<void> =>
  AuthorizePanelObjectOpen(ownerWindowName, windowName, panelId, objectRef, activeView);

export const updatePanelWindowSnapshot = (
  windowName: string,
  snapshot: panelwindow.GroupSnapshot
): Promise<void> => UpdatePanelWindowSnapshot(windowName, snapshot);

export const requestPanelTabClose = (windowName: string, panelId: string): Promise<void> =>
  RequestPanelTabClose(windowName, panelId);

export const authorizePanelTabClose = (
  ownerWindowName: string,
  windowName: string,
  panelId: string
): Promise<void> => AuthorizePanelTabClose(ownerWindowName, windowName, panelId);

export const requestPanelTabTransfer = (
  callerWindowName: string,
  request: panelwindow.TabTransferRequest
): Promise<void> => RequestPanelTabTransfer(callerWindowName, request);

export const acceptPanelTabTransfer = (
  ownerWindowName: string,
  transferId: string
): Promise<void> => AcceptPanelTabTransfer(ownerWindowName, transferId);

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

export const onOwnerCloseRequested = (
  handler: (event: panelwindow.OwnerCloseRequestedEvent) => void
) => onEvent('panel-window:owner-close-requested', handler);

export const onPanelObjectOpenRequested = (
  handler: (event: panelwindow.ObjectOpenRequestEvent) => void
) => onEvent('panel-window:object-open-requested', handler);

export const onPanelObjectOpenAuthorized = (
  handler: (event: panelwindow.ObjectOpenAuthorizedEvent) => void
) => onEvent('panel-window:object-open-authorized', handler);

export const onPanelWindowSnapshotUpdated = (
  handler: (event: panelwindow.SnapshotUpdatedEvent) => void
) => onEvent('panel-window:snapshot-updated', handler);

export const onPanelTabCloseRequested = (
  handler: (event: panelwindow.TabCloseRequestedEvent) => void
) => onEvent('panel-window:tab-close-requested', handler);

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

export const onPanelWindowGuardRequested = (
  handler: (event: panelwindow.WindowGuardRequestedEvent) => void
) => onEvent('panel-window:guard-requested', handler);

export const onPanelWindowGuardResult = (
  handler: (event: panelwindow.WindowGuardResultEvent) => void
) => onEvent('panel-window:guard-result', handler);
