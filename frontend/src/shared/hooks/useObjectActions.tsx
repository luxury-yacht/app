/**
 * frontend/src/shared/hooks/useObjectActions.tsx
 *
 * Shared utility for building context menu / actions menu items for Kubernetes objects.
 * Production callers should use useObjectActionController instead of calling this directly.
 */

import {
  OBJECT_ACTION_IDS,
  objectActionInvolvedObjectLabel,
  objectActionLabel,
} from '@shared/actions/objectActionContract';
import {
  normalizeKind,
  type ObjectActionData,
  type PermissionStatus,
  resolveObjectActionPolicy,
  SCALABLE_KINDS,
} from '@shared/actions/objectActionPolicy';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { buildObjectDiffSelection } from '@shared/components/diff/objectDiffSelection';
import { ObjectMapIcon } from '@shared/components/icons/ObjectMapIcons';
import {
  CordonIcon,
  DeleteIcon,
  DiffIcon,
  DrainIcon,
  OpenIcon,
  PortForwardIcon,
  RestartIcon,
  RollbackIcon,
  ScaleIcon,
} from '@shared/components/icons/SharedIcons';
import { resourceLinkDisplayKind } from '@shared/utils/resourceLinkIdentity';
import { eventBus } from '@/core/events';

// Action handlers
export interface ObjectActionHandlers {
  onOpen?: () => void;
  onNavigateView?: () => void;
  onRestart?: () => void;
  onRollback?: () => void;
  onScale?: () => void;
  onScaleToZero?: () => void;
  onResumeFromZero?: () => void;
  onDelete?: () => void;
  onPortForward?: () => void;
  // Node-only: cordon/uncordon share a single handler — the menu picks the
  // label based on object.unschedulable.
  onCordon?: () => void;
  onDrain?: () => void;
  // CronJob actions
  onTrigger?: () => void;
  onSuspendToggle?: () => void;
  // Event actions - view the involved object
  onViewInvolvedObject?: () => void;
  // Object map - kind-agnostic so any view can opt in. v1 only wires
  // this from NsViewWorkloads; the menu item is hidden when no handler
  // is provided so other views are unaffected until they pass it.
  onObjectMap?: () => void;
}

let nextObjectDiffRequestId = 1;

export type { ObjectActionData, PermissionStatus };
export { normalizeKind, SCALABLE_KINDS };

// Options for building action items
export interface BuildObjectActionsOptions {
  object: ObjectActionData;
  context: 'gridtable' | 'object-map' | 'object-panel';
  handlers: ObjectActionHandlers;
  permissions: {
    restart?: PermissionStatus | null;
    rollback?: PermissionStatus | null;
    scale?: PermissionStatus | null;
    trigger?: PermissionStatus | null;
    suspend?: PermissionStatus | null;
    delete?: PermissionStatus | null;
    portForward?: PermissionStatus | null;
    cordon?: PermissionStatus | null;
    drain?: PermissionStatus | null;
  };
  actionLoading?: boolean;
}

/**
 * Build menu items for an object. Production callers should go through
 * useObjectActionController so permission lookup and action execution stay centralized.
 */
export function buildObjectActionItems({
  object,
  context,
  handlers,
  permissions,
  actionLoading = false,
}: BuildObjectActionsOptions): ContextMenuItem[] {
  const menuItems: ContextMenuItem[] = [];
  const diffSelection =
    object.kind === 'Event' && object.involvedObject ? null : buildObjectDiffSelection(object);
  const policy = resolveObjectActionPolicy({
    object,
    context,
    handlers: {
      restart: Boolean(handlers.onRestart),
      rollback: Boolean(handlers.onRollback),
      scale: Boolean(handlers.onScale),
      scaleToZero: Boolean(handlers.onScaleToZero),
      resumeFromZero: Boolean(handlers.onResumeFromZero),
      delete: Boolean(handlers.onDelete),
      portForward: Boolean(handlers.onPortForward),
      cordon: Boolean(handlers.onCordon),
      drain: Boolean(handlers.onDrain),
      trigger: Boolean(handlers.onTrigger),
      suspendToggle: Boolean(handlers.onSuspendToggle),
    },
    permissions,
    actionLoading,
  });

  // Open - only for surfaces that are not already the object panel.
  if ((context === 'gridtable' || context === 'object-map') && handlers.onOpen) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.viewDetails,
      label: objectActionLabel(OBJECT_ACTION_IDS.viewDetails),
      icon: <OpenIcon />,
      onClick: handlers.onOpen,
    });
  }

  // Map - sits with the navigation block so it picks up the
  // shared section divider (see useGridTableContextMenuItems). The
  // handler is opt-in per call site; when omitted, no item is added.
  if (handlers.onObjectMap) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.viewMap,
      label: objectActionLabel(OBJECT_ACTION_IDS.viewMap),
      icon: <ObjectMapIcon />,
      onClick: handlers.onObjectMap,
    });
  }

  if (context !== 'gridtable' && handlers.onNavigateView) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.goToTable,
      label: objectActionLabel(OBJECT_ACTION_IDS.goToTable),
      icon: <OpenIcon />,
      onClick: handlers.onNavigateView,
    });
  }

  if (diffSelection) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.diff,
      label: objectActionLabel(OBJECT_ACTION_IDS.diff),
      icon: <DiffIcon />,
      onClick: () => {
        eventBus.emit('view:open-object-diff', {
          requestId: nextObjectDiffRequestId++,
          left: diffSelection,
        });
      },
    });
  }

  // Event-specific actions - view the involved object
  if (
    object.kind === 'Event' &&
    (object.involvedObject || object.involvedObjectRef) &&
    handlers.onViewInvolvedObject
  ) {
    const involvedKind =
      resourceLinkDisplayKind(object.involvedObjectRef) ?? object.involvedObject?.split('/')[0];
    if (involvedKind && involvedKind !== '-') {
      menuItems.push({
        actionId: OBJECT_ACTION_IDS.viewInvolvedObject,
        label: objectActionInvolvedObjectLabel(involvedKind),
        icon: <OpenIcon />,
        onClick: handlers.onViewInvolvedObject,
      });
    }
  }

  // Permission pending header
  if (menuItems.length > 0 && policy.hasActionSection) {
    menuItems.push({ divider: true });
  }

  if (policy.anyPending) {
    menuItems.push({ header: true, label: 'Awaiting permissions...' });
  }

  // CronJob-specific actions
  if (policy.normalizedKind === 'CronJob') {
    if (policy.triggerEnabled) {
      menuItems.push({
        actionId: OBJECT_ACTION_IDS.triggerNow,
        label: objectActionLabel(OBJECT_ACTION_IDS.triggerNow),
        icon: '▶',
        onClick: handlers.onTrigger,
        disabled: policy.triggerDisabled,
      });
    }

    if (policy.suspendActionId) {
      menuItems.push({
        actionId: policy.suspendActionId,
        label: objectActionLabel(policy.suspendActionId),
        icon: policy.suspendActionId === OBJECT_ACTION_IDS.resume ? '▶' : '⏸',
        onClick: handlers.onSuspendToggle,
        disabled: actionLoading,
      });
    }
  }

  // Restart
  if (policy.restartEnabled && handlers.onRestart) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.restart,
      label: objectActionLabel(OBJECT_ACTION_IDS.restart),
      icon: <RestartIcon />,
      onClick: handlers.onRestart,
      disabled: actionLoading,
    });
  }

  // Rollback
  if (policy.rollbackEnabled && handlers.onRollback) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.rollback,
      label: objectActionLabel(OBJECT_ACTION_IDS.rollback),
      icon: <RollbackIcon />,
      onClick: handlers.onRollback,
      disabled: actionLoading,
    });
  }

  // Scale
  if (policy.scaleActionId) {
    const scaleHandler =
      policy.scaleActionId === OBJECT_ACTION_IDS.resumeFromZero
        ? handlers.onResumeFromZero
        : policy.scaleActionId === OBJECT_ACTION_IDS.scaleToZero
          ? handlers.onScaleToZero
          : handlers.onScale;
    menuItems.push({
      actionId: policy.scaleActionId,
      label: objectActionLabel(policy.scaleActionId),
      icon: <ScaleIcon />,
      onClick: scaleHandler,
      disabled: policy.scaleActionDisabled,
    });
  }

  // Cordon / Uncordon (Node-only)
  if (policy.cordonActionId && handlers.onCordon) {
    menuItems.push({
      actionId: policy.cordonActionId,
      label: objectActionLabel(policy.cordonActionId),
      icon: <CordonIcon />,
      onClick: handlers.onCordon,
      disabled: actionLoading,
    });
  }

  // Drain (Node-only)
  if (policy.drainEnabled && handlers.onDrain) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.drain,
      label: objectActionLabel(OBJECT_ACTION_IDS.drain),
      icon: <DrainIcon />,
      onClick: handlers.onDrain,
      disabled: actionLoading,
    });
  }

  // Port Forward
  if (policy.portForward.show && !policy.portForward.enabled) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.portForward,
      label: objectActionLabel(policy.portForward.actionId),
      icon: <PortForwardIcon />,
      disabled: true,
    });
  } else if (policy.portForwardEnabled && handlers.onPortForward) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.portForward,
      label: objectActionLabel(policy.portForward.actionId),
      icon: <PortForwardIcon />,
      onClick: handlers.onPortForward,
      disabled: actionLoading,
    });
  }

  // Delete (with divider if there are other items)
  if (policy.deleteEnabled && handlers.onDelete) {
    // Add divider before Delete if there are other action items
    const hasOtherActions = menuItems.some((item) => !('header' in item) && !('divider' in item));
    const lastItem = menuItems[menuItems.length - 1];
    if (hasOtherActions && !(lastItem && 'divider' in lastItem && lastItem.divider)) {
      menuItems.push({ divider: true });
    }

    menuItems.push({
      actionId: OBJECT_ACTION_IDS.delete,
      label: objectActionLabel(OBJECT_ACTION_IDS.delete),
      icon: <DeleteIcon />,
      danger: true,
      onClick: handlers.onDelete,
      disabled: actionLoading,
    });
  }

  return menuItems;
}
