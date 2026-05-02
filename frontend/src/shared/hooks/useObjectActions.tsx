/**
 * frontend/src/shared/hooks/useObjectActions.tsx
 *
 * Shared hook and utility for building context menu / actions menu items for Kubernetes objects.
 * Used by both GridTable context menus and Object Panel actions menus.
 */

import { useMemo } from 'react';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { eventBus } from '@/core/events';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import {
  DiffIcon,
  ObjectMapIcon,
  OpenIcon,
  RestartIcon,
  RollbackIcon,
  ScaleIcon,
  DeleteIcon,
  PortForwardIcon,
} from '@shared/components/icons/MenuIcons';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { buildObjectDiffSelection } from '@shared/components/diff/objectDiffSelection';

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
  // For workload-specific actions
  status?: string;
  ready?: string;
  // Whether the target exposes any forwardable TCP ports.
  portForwardAvailable?: boolean;
  // Whether a HorizontalPodAutoscaler targets this workload (disables manual scaling)
  hpaManaged?: boolean;
  // For Event-specific actions - the involved object reference (e.g., "Pod/my-pod")
  involvedObject?: string;
}

// Action handlers
export interface ObjectActionHandlers {
  onOpen?: () => void;
  onRestart?: () => void;
  onRollback?: () => void;
  onScale?: () => void;
  onDelete?: () => void;
  onPortForward?: () => void;
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
export const RESTARTABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
const ROLLBACKABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
export const SCALABLE_KINDS = ['Deployment', 'StatefulSet', 'ReplicaSet'];
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
  context: 'gridtable' | 'object-panel';
  handlers: ObjectActionHandlers;
  permissions: {
    restart?: PermissionStatus | null;
    rollback?: PermissionStatus | null;
    scale?: PermissionStatus | null;
    delete?: PermissionStatus | null;
    portForward?: PermissionStatus | null;
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
    return { show: false, enabled: false, label: 'Port Forward' };
  }

  const builtin = resolveBuiltinGroupVersion(object.kind);
  const group = object.group ?? builtin.group;
  const version = object.version ?? builtin.version;

  if (!object.clusterId || !object.namespace) {
    return {
      show: true,
      enabled: false,
      label: 'Port Forward',
    };
  }

  if (group !== expectedTarget.group || version !== expectedTarget.version) {
    return {
      show: true,
      enabled: false,
      label: 'Port Forward',
    };
  }

  if (object.portForwardAvailable === false) {
    return {
      show: true,
      enabled: false,
      label: 'Port Forward',
    };
  }

  return {
    show: true,
    enabled: true,
    label: 'Port Forward',
  };
}

/**
 * Build menu items for an object. Can be used directly or via the useObjectActions hook.
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
  } = permissions;

  // Open - only for gridtable context
  if (context === 'gridtable' && handlers.onOpen) {
    menuItems.push({
      label: 'Open',
      icon: <OpenIcon />,
      onClick: handlers.onOpen,
    });
  }

  // Object Map - sits with the navigation block so it picks up the
  // shared section divider (see useGridTableContextMenuItems). The
  // handler is opt-in per call site; when omitted, no item is added.
  if (handlers.onObjectMap) {
    menuItems.push({
      label: 'Object Map',
      icon: <ObjectMapIcon />,
      onClick: handlers.onObjectMap,
    });
  }

  if (diffSelection) {
    menuItems.push({
      label: 'Diff',
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
        label: `View ${involvedKind}`,
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

  const hasFollowUpSection =
    anyPending ||
    normalizedKind === 'CronJob' ||
    (RESTARTABLE_KINDS.includes(normalizedKind) && Boolean(handlers.onRestart)) ||
    (ROLLBACKABLE_KINDS.includes(normalizedKind) && Boolean(handlers.onRollback)) ||
    (SCALABLE_KINDS.includes(normalizedKind) &&
      (Boolean(object.hpaManaged) || Boolean(handlers.onScale))) ||
    portForwardAvailability.show ||
    Boolean(handlers.onDelete);

  if (menuItems.length > 0 && hasFollowUpSection) {
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
        label: 'Trigger Now',
        icon: '▶',
        onClick: handlers.onTrigger,
        disabled: isSuspended || actionLoading,
      });
    }

    if (handlers.onSuspendToggle) {
      menuItems.push({
        label: isSuspended ? 'Resume' : 'Suspend',
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
      label: 'Restart',
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
      label: 'Rollback',
      icon: <RollbackIcon />,
      onClick: handlers.onRollback,
      disabled: actionLoading,
    });
  }

  // Scale – disabled with explanation when managed by an HPA
  if (SCALABLE_KINDS.includes(normalizedKind) && scaleStatus?.allowed && !scaleStatus.pending) {
    if (object.hpaManaged) {
      menuItems.push({
        label: 'Scale (HPA managed)',
        icon: <ScaleIcon />,
        disabled: true,
      });
    } else if (handlers.onScale) {
      menuItems.push({
        label: 'Scale',
        icon: <ScaleIcon />,
        onClick: handlers.onScale,
        disabled: actionLoading,
      });
    }
  }

  // Port Forward
  if (portForwardAvailability.show && !portForwardAvailability.enabled) {
    menuItems.push({
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
    if (hasOtherActions) {
      menuItems.push({ divider: true });
    }

    menuItems.push({
      label: 'Delete',
      icon: <DeleteIcon />,
      danger: true,
      onClick: handlers.onDelete,
      disabled: actionLoading,
    });
  }

  return menuItems;
}

// Hook options
export interface UseObjectActionsOptions {
  object: ObjectActionData | null;
  context: 'gridtable' | 'object-panel';
  handlers: ObjectActionHandlers;
  actionLoading?: boolean;
}

/**
 * Hook for building object action menu items. Uses useUserPermissions internally.
 * For use in React components. For callbacks, use buildObjectActionItems directly.
 */
export function useObjectActions({
  object,
  context,
  handlers,
  actionLoading = false,
}: UseObjectActionsOptions): ContextMenuItem[] {
  const permissionMap = useUserPermissions();

  const items = useMemo(() => {
    if (!object) return [];

    const normalizedKind = normalizeKind(object.kind);
    const namespace = object.namespace || '';

    // Get permissions from the map. Group/version are threaded through so
    // CRD lookups produce the same key as the spec-emit side
    // (queryKindPermissions). Built-in kinds work either way because
    // getPermissionKey auto-resolves built-in GVK; CRDs do not, so the
    // hook must forward what the caller supplied.
    const clusterId = object.clusterId ?? undefined;
    const objectGroup = object.group ?? undefined;
    const objectVersion = object.version ?? undefined;
    const restartStatus =
      permissionMap.get(
        getPermissionKey(
          normalizedKind,
          'patch',
          namespace,
          null,
          clusterId,
          objectGroup,
          objectVersion
        )
      ) ?? null;
    // Rollback uses the same patch permission as restart
    const rollbackStatus = restartStatus;
    const scaleStatus =
      permissionMap.get(
        getPermissionKey(
          normalizedKind,
          'update',
          namespace,
          'scale',
          clusterId,
          objectGroup,
          objectVersion
        )
      ) ?? null;
    const deleteStatus =
      permissionMap.get(
        getPermissionKey(
          object.kind,
          'delete',
          namespace,
          null,
          clusterId,
          objectGroup,
          objectVersion
        )
      ) ?? null;
    // Port forward requires create permission on pods/portforward subresource.
    // Always targets core/v1 Pod regardless of the object's own kind, so the
    // GVK is hardcoded rather than threaded from `object`.
    const portForwardStatus =
      permissionMap.get(
        getPermissionKey('Pod', 'create', namespace, 'portforward', clusterId, '', 'v1')
      ) ?? null;

    return buildObjectActionItems({
      object,
      context,
      handlers,
      permissions: {
        restart: restartStatus,
        rollback: rollbackStatus,
        scale: scaleStatus,
        delete: deleteStatus,
        portForward: portForwardStatus,
      },
      actionLoading,
    });
  }, [object, context, handlers, actionLoading, permissionMap]);

  return items;
}
