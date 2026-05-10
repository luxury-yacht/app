/**
 * frontend/src/shared/hooks/useObjectActions.tsx
 *
 * Shared utility for building context menu / actions menu items for Kubernetes objects.
 * Production callers should use useObjectActionController instead of calling this directly.
 */

import { eventBus } from '@/core/events';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
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
import { ObjectMapIcon } from '@shared/components/icons/ObjectMapIcons';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { buildObjectDiffSelection } from '@shared/components/diff/objectDiffSelection';
import {
  OBJECT_ACTION_IDS,
  objectActionInvolvedObjectLabel,
  objectActionLabel,
} from '@shared/actions/objectActionDescriptors';

// Normalized kind mapping for permission checks
const WORKLOAD_KIND_MAP: Record<string, string> = {
  Deployment: 'Deployment',
  deployment: 'Deployment',
  StatefulSet: 'StatefulSet',
  statefulset: 'StatefulSet',
  DaemonSet: 'DaemonSet',
  daemonset: 'DaemonSet',
  ReplicaSet: 'ReplicaSet',
  replicaset: 'ReplicaSet',
  Pod: 'Pod',
  pod: 'Pod',
  Job: 'Job',
  job: 'Job',
  CronJob: 'CronJob',
  cronjob: 'CronJob',
};

export function normalizeKind(kind: string): string {
  return WORKLOAD_KIND_MAP[kind] || kind;
}

// Object data needed for actions
export interface ObjectActionData {
  kind: string;
  name: string;
  namespace?: string;
  clusterId?: string;
  clusterName?: string;
  // API group/version for the object's kind. Required to look up CRD
  // permissions correctly: getPermissionKey only auto-resolves built-in
  // GVK from a static table, so CRD callers must thread these through
  // or the lookup key won't match the spec-emit key from
  // queryKindPermissions and the Delete action silently disappears.
  group?: string;
  version?: string;
  resource?: string;
  uid?: string;
  requiresExplicitVersion?: boolean;
  explicitVersionProvided?: boolean;
  // For workload-specific actions
  status?: string;
  ready?: string;
  // Whether the target exposes any forwardable TCP ports.
  portForwardAvailable?: boolean;
  // Whether a HorizontalPodAutoscaler targets this workload (disables manual scaling)
  hpaManaged?: boolean;
  // Node-only: when true the cordon action toggles to "Uncordon".
  unschedulable?: boolean;
  // For Event-specific actions - the involved object reference (e.g., "Pod/my-pod")
  involvedObject?: string;
}

// Action handlers
export interface ObjectActionHandlers {
  onOpen?: () => void;
  onNavigateView?: () => void;
  onRestart?: () => void;
  onRollback?: () => void;
  onScale?: () => void;
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

// Permission status type (matches what useUserPermissions returns)
export interface PermissionStatus {
  allowed: boolean;
  pending: boolean;
}

interface PortForwardAvailability {
  show: boolean;
  enabled: boolean;
  label: string;
}

// Kinds that support each action
const RESTARTABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
const ROLLBACKABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
export const SCALABLE_KINDS = ['Deployment', 'StatefulSet', 'ReplicaSet'];
const CORDONABLE_KINDS = ['Node'];
const DRAINABLE_KINDS = ['Node'];
let nextObjectDiffRequestId = 1;

const PORT_FORWARDABLE_TARGETS: Record<string, { group: string; version: string }> = {
  Pod: { group: '', version: 'v1' },
  Deployment: { group: 'apps', version: 'v1' },
  StatefulSet: { group: 'apps', version: 'v1' },
  DaemonSet: { group: 'apps', version: 'v1' },
  Service: { group: '', version: 'v1' },
};

// Options for building action items
export interface BuildObjectActionsOptions {
  object: ObjectActionData;
  context: 'gridtable' | 'object-map' | 'object-panel';
  handlers: ObjectActionHandlers;
  permissions: {
    restart?: PermissionStatus | null;
    rollback?: PermissionStatus | null;
    scale?: PermissionStatus | null;
    delete?: PermissionStatus | null;
    portForward?: PermissionStatus | null;
    cordon?: PermissionStatus | null;
    drain?: PermissionStatus | null;
  };
  actionLoading?: boolean;
}

function getPortForwardAvailability(
  object: ObjectActionData,
  handlers: ObjectActionHandlers
): PortForwardAvailability {
  const normalizedKind = normalizeKind(object.kind);
  const expectedTarget = PORT_FORWARDABLE_TARGETS[normalizedKind];

  if (!expectedTarget || !handlers.onPortForward) {
    return {
      show: false,
      enabled: false,
      label: objectActionLabel(OBJECT_ACTION_IDS.portForward),
    };
  }

  const builtin = resolveBuiltinGroupVersion(object.kind);
  const group = object.group ?? builtin.group;
  const version = object.version ?? builtin.version;

  if (!object.clusterId || !object.namespace) {
    return {
      show: true,
      enabled: false,
      label: objectActionLabel(OBJECT_ACTION_IDS.portForward),
    };
  }

  if (group !== expectedTarget.group || version !== expectedTarget.version) {
    return {
      show: true,
      enabled: false,
      label: objectActionLabel(OBJECT_ACTION_IDS.portForward),
    };
  }

  if (object.portForwardAvailable === false) {
    return {
      show: true,
      enabled: false,
      label: objectActionLabel(OBJECT_ACTION_IDS.portForward),
    };
  }

  return {
    show: true,
    enabled: true,
    label: objectActionLabel(OBJECT_ACTION_IDS.portForward),
  };
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
  const normalizedKind = normalizeKind(object.kind);
  const diffSelection =
    object.kind === 'Event' && object.involvedObject ? null : buildObjectDiffSelection(object);
  const portForwardAvailability = getPortForwardAvailability(object, handlers);

  const {
    restart: restartStatus,
    rollback: rollbackStatus,
    scale: scaleStatus,
    delete: deleteStatus,
    portForward: portForwardStatus,
    cordon: cordonStatus,
    drain: drainStatus,
  } = permissions;

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
  if (object.kind === 'Event' && object.involvedObject && handlers.onViewInvolvedObject) {
    // Parse the involved object reference (e.g., "Pod/my-pod" -> "Pod")
    const [involvedKind] = object.involvedObject.split('/');
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
  const anyPending =
    restartStatus?.pending ||
    rollbackStatus?.pending ||
    scaleStatus?.pending ||
    deleteStatus?.pending ||
    portForwardStatus?.pending;

  const hasActionSection =
    anyPending ||
    normalizedKind === 'CronJob' ||
    (RESTARTABLE_KINDS.includes(normalizedKind) && Boolean(handlers.onRestart)) ||
    (ROLLBACKABLE_KINDS.includes(normalizedKind) && Boolean(handlers.onRollback)) ||
    (SCALABLE_KINDS.includes(normalizedKind) &&
      (Boolean(object.hpaManaged) || Boolean(handlers.onScale))) ||
    (CORDONABLE_KINDS.includes(normalizedKind) && Boolean(handlers.onCordon)) ||
    (DRAINABLE_KINDS.includes(normalizedKind) && Boolean(handlers.onDrain)) ||
    portForwardAvailability.show;

  if (menuItems.length > 0 && hasActionSection) {
    menuItems.push({ divider: true });
  }

  if (anyPending) {
    menuItems.push({ header: true, label: 'Awaiting permissions...' });
  }

  // CronJob-specific actions
  if (normalizedKind === 'CronJob') {
    const isSuspended = object.status === 'Suspended';

    if (handlers.onTrigger) {
      menuItems.push({
        actionId: OBJECT_ACTION_IDS.triggerNow,
        label: objectActionLabel(OBJECT_ACTION_IDS.triggerNow),
        icon: '▶',
        onClick: handlers.onTrigger,
        disabled: isSuspended || actionLoading,
      });
    }

    if (handlers.onSuspendToggle) {
      const suspendActionId = isSuspended ? OBJECT_ACTION_IDS.resume : OBJECT_ACTION_IDS.suspend;
      menuItems.push({
        actionId: suspendActionId,
        label: objectActionLabel(suspendActionId),
        icon: isSuspended ? '▶' : '⏸',
        onClick: handlers.onSuspendToggle,
        disabled: actionLoading,
      });
    }
  }

  // Restart
  if (
    RESTARTABLE_KINDS.includes(normalizedKind) &&
    restartStatus?.allowed &&
    !restartStatus.pending &&
    handlers.onRestart
  ) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.restart,
      label: objectActionLabel(OBJECT_ACTION_IDS.restart),
      icon: <RestartIcon />,
      onClick: handlers.onRestart,
      disabled: actionLoading,
    });
  }

  // Rollback
  if (
    ROLLBACKABLE_KINDS.includes(normalizedKind) &&
    rollbackStatus?.allowed &&
    !rollbackStatus.pending &&
    handlers.onRollback
  ) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.rollback,
      label: objectActionLabel(OBJECT_ACTION_IDS.rollback),
      icon: <RollbackIcon />,
      onClick: handlers.onRollback,
      disabled: actionLoading,
    });
  }

  // Scale – disabled with explanation when managed by an HPA
  if (SCALABLE_KINDS.includes(normalizedKind) && scaleStatus?.allowed && !scaleStatus.pending) {
    if (object.hpaManaged) {
      menuItems.push({
        actionId: OBJECT_ACTION_IDS.scaleHpaManaged,
        label: objectActionLabel(OBJECT_ACTION_IDS.scaleHpaManaged),
        icon: <ScaleIcon />,
        disabled: true,
      });
    } else if (handlers.onScale) {
      menuItems.push({
        actionId: OBJECT_ACTION_IDS.scale,
        label: objectActionLabel(OBJECT_ACTION_IDS.scale),
        icon: <ScaleIcon />,
        onClick: handlers.onScale,
        disabled: actionLoading,
      });
    }
  }

  // Cordon / Uncordon (Node-only)
  if (
    CORDONABLE_KINDS.includes(normalizedKind) &&
    handlers.onCordon &&
    cordonStatus?.allowed &&
    !cordonStatus.pending
  ) {
    const isCordoned = Boolean(object.unschedulable);
    const cordonActionId = isCordoned ? OBJECT_ACTION_IDS.uncordon : OBJECT_ACTION_IDS.cordon;
    menuItems.push({
      actionId: cordonActionId,
      label: objectActionLabel(cordonActionId),
      icon: <CordonIcon />,
      onClick: handlers.onCordon,
      disabled: actionLoading,
    });
  }

  // Drain (Node-only)
  if (
    DRAINABLE_KINDS.includes(normalizedKind) &&
    handlers.onDrain &&
    drainStatus?.allowed &&
    !drainStatus.pending
  ) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.drain,
      label: objectActionLabel(OBJECT_ACTION_IDS.drain),
      icon: <DrainIcon />,
      onClick: handlers.onDrain,
      disabled: actionLoading,
    });
  }

  // Port Forward
  if (portForwardAvailability.show && !portForwardAvailability.enabled) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.portForward,
      label: portForwardAvailability.label,
      icon: <PortForwardIcon />,
      disabled: true,
    });
  } else if (
    portForwardAvailability.show &&
    portForwardStatus?.allowed &&
    !portForwardStatus.pending &&
    handlers.onPortForward
  ) {
    menuItems.push({
      actionId: OBJECT_ACTION_IDS.portForward,
      label: portForwardAvailability.label,
      icon: <PortForwardIcon />,
      onClick: handlers.onPortForward,
      disabled: actionLoading,
    });
  }

  // Delete (with divider if there are other items)
  if (deleteStatus?.allowed && !deleteStatus.pending && handlers.onDelete) {
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
