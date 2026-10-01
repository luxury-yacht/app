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
  type ObjectActionData,
  type ObjectActionPolicy,
  type PermissionStatus,
  resolveObjectActionPolicy,
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

export { normalizeKind, SCALABLE_KINDS } from '@shared/actions/objectActionPolicy';
export type { ObjectActionData, PermissionStatus };

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

const compactMenuItems = (items: Array<ContextMenuItem | null | undefined>): ContextMenuItem[] =>
  items.filter((item): item is ContextMenuItem => item !== null && item !== undefined);

const buildOpenItem = ({
  context,
  handlers,
}: Pick<BuildObjectActionsOptions, 'context' | 'handlers'>): ContextMenuItem | null => {
  if ((context !== 'gridtable' && context !== 'object-map') || !handlers.onOpen) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.viewDetails,
    label: objectActionLabel(OBJECT_ACTION_IDS.viewDetails),
    icon: <OpenIcon />,
    onClick: handlers.onOpen,
  };
};

const buildObjectMapItem = (handlers: ObjectActionHandlers): ContextMenuItem | null => {
  if (!handlers.onObjectMap) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.viewMap,
    label: objectActionLabel(OBJECT_ACTION_IDS.viewMap),
    icon: <ObjectMapIcon />,
    onClick: handlers.onObjectMap,
  };
};

const buildTableNavigationItem = ({
  context,
  handlers,
}: Pick<BuildObjectActionsOptions, 'context' | 'handlers'>): ContextMenuItem | null => {
  if (context === 'gridtable' || !handlers.onNavigateView) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.goToTable,
    label: objectActionLabel(OBJECT_ACTION_IDS.goToTable),
    icon: <OpenIcon />,
    onClick: handlers.onNavigateView,
  };
};

const buildDiffItem = (object: ObjectActionData): ContextMenuItem | null => {
  const selection =
    object.kind === 'Event' && object.involvedObject ? null : buildObjectDiffSelection(object);
  if (!selection) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.diff,
    label: objectActionLabel(OBJECT_ACTION_IDS.diff),
    icon: <DiffIcon />,
    onClick: () => {
      eventBus.emit('view:open-object-diff', {
        requestId: nextObjectDiffRequestId++,
        left: selection,
      });
    },
  };
};

const buildInvolvedObjectItem = (
  object: ObjectActionData,
  handlers: ObjectActionHandlers
): ContextMenuItem | null => {
  const hasInvolvedObject = Boolean(object.involvedObject || object.involvedObjectRef);
  if (object.kind !== 'Event' || !hasInvolvedObject || !handlers.onViewInvolvedObject) {
    return null;
  }
  // The label names the kind from the backend's involved-object link.
  const involvedKind = resourceLinkDisplayKind(object.involvedObjectRef);
  if (!involvedKind) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.viewInvolvedObject,
    label: objectActionInvolvedObjectLabel(involvedKind),
    icon: <OpenIcon />,
    onClick: handlers.onViewInvolvedObject,
  };
};

const buildNavigationItems = ({
  object,
  context,
  handlers,
}: Pick<BuildObjectActionsOptions, 'object' | 'context' | 'handlers'>): ContextMenuItem[] =>
  compactMenuItems([
    buildOpenItem({ context, handlers }),
    buildObjectMapItem(handlers),
    buildTableNavigationItem({ context, handlers }),
    buildDiffItem(object),
    buildInvolvedObjectItem(object, handlers),
  ]);

const buildCronJobItems = (
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers,
  actionLoading: boolean
): ContextMenuItem[] => {
  if (policy.normalizedKind !== 'CronJob') {
    return [];
  }
  const triggerItem = policy.triggerEnabled
    ? {
        actionId: OBJECT_ACTION_IDS.triggerNow,
        label: objectActionLabel(OBJECT_ACTION_IDS.triggerNow),
        icon: '▶',
        onClick: handlers.onTrigger,
        disabled: policy.triggerDisabled,
      }
    : null;
  const suspendItem = policy.suspendActionId
    ? {
        actionId: policy.suspendActionId,
        label: objectActionLabel(policy.suspendActionId),
        icon: policy.suspendActionId === OBJECT_ACTION_IDS.resume ? '▶' : '⏸',
        onClick: handlers.onSuspendToggle,
        disabled: actionLoading,
      }
    : null;
  return compactMenuItems([triggerItem, suspendItem]);
};

const buildRestartItem = (
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers,
  actionLoading: boolean
): ContextMenuItem | null => {
  if (!policy.restartEnabled || !handlers.onRestart) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.restart,
    label: objectActionLabel(OBJECT_ACTION_IDS.restart),
    icon: <RestartIcon />,
    onClick: handlers.onRestart,
    disabled: actionLoading,
  };
};

const buildRollbackItem = (
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers,
  actionLoading: boolean
): ContextMenuItem | null => {
  if (!policy.rollbackEnabled || !handlers.onRollback) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.rollback,
    label: objectActionLabel(OBJECT_ACTION_IDS.rollback),
    icon: <RollbackIcon />,
    onClick: handlers.onRollback,
    disabled: actionLoading,
  };
};

const scaleHandlerFor = (
  actionId: ObjectActionPolicy['scaleActionId'],
  handlers: ObjectActionHandlers
): ObjectActionHandlers['onScale'] => {
  switch (actionId) {
    case OBJECT_ACTION_IDS.resumeFromZero:
      return handlers.onResumeFromZero;
    case OBJECT_ACTION_IDS.scaleToZero:
      return handlers.onScaleToZero;
    default:
      return handlers.onScale;
  }
};

const buildScaleItem = (
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers
): ContextMenuItem | null => {
  if (!policy.scaleActionId) {
    return null;
  }
  return {
    actionId: policy.scaleActionId,
    label: objectActionLabel(policy.scaleActionId),
    icon: <ScaleIcon />,
    onClick: scaleHandlerFor(policy.scaleActionId, handlers),
    disabled: policy.scaleActionDisabled,
  };
};

const buildNodeItems = (
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers,
  actionLoading: boolean
): ContextMenuItem[] => {
  const cordonItem =
    policy.cordonActionId && handlers.onCordon
      ? {
          actionId: policy.cordonActionId,
          label: objectActionLabel(policy.cordonActionId),
          icon: <CordonIcon />,
          onClick: handlers.onCordon,
          disabled: actionLoading,
        }
      : null;
  const drainItem =
    policy.drainEnabled && handlers.onDrain
      ? {
          actionId: OBJECT_ACTION_IDS.drain,
          label: objectActionLabel(OBJECT_ACTION_IDS.drain),
          icon: <DrainIcon />,
          onClick: handlers.onDrain,
          disabled: actionLoading,
        }
      : null;
  return compactMenuItems([cordonItem, drainItem]);
};

const buildPortForwardItem = (
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers,
  actionLoading: boolean
): ContextMenuItem | null => {
  if (policy.portForward.show && !policy.portForward.enabled) {
    return {
      actionId: OBJECT_ACTION_IDS.portForward,
      label: objectActionLabel(policy.portForward.actionId),
      icon: <PortForwardIcon />,
      disabled: true,
    };
  }
  if (!policy.portForwardEnabled || !handlers.onPortForward) {
    return null;
  }
  return {
    actionId: OBJECT_ACTION_IDS.portForward,
    label: objectActionLabel(policy.portForward.actionId),
    icon: <PortForwardIcon />,
    onClick: handlers.onPortForward,
    disabled: actionLoading,
  };
};

const buildMutationItems = (
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers,
  actionLoading: boolean
): ContextMenuItem[] =>
  compactMenuItems([
    ...buildCronJobItems(policy, handlers, actionLoading),
    buildRestartItem(policy, handlers, actionLoading),
    buildRollbackItem(policy, handlers, actionLoading),
    buildScaleItem(policy, handlers),
    ...buildNodeItems(policy, handlers, actionLoading),
    buildPortForwardItem(policy, handlers, actionLoading),
  ]);

const appendDeleteItem = (
  menuItems: ContextMenuItem[],
  policy: ObjectActionPolicy,
  handlers: ObjectActionHandlers,
  actionLoading: boolean
): void => {
  if (!policy.deleteEnabled || !handlers.onDelete) {
    return;
  }
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
};

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
  const menuItems = buildNavigationItems({ object, context, handlers });
  if (menuItems.length > 0 && policy.hasActionSection) {
    menuItems.push({ divider: true });
  }
  if (policy.anyPending) {
    menuItems.push({ header: true, label: 'Awaiting permissions...' });
  }
  menuItems.push(...buildMutationItems(policy, handlers, actionLoading));
  appendDeleteItem(menuItems, policy, handlers, actionLoading);
  return menuItems;
}
