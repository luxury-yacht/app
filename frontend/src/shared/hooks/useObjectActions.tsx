/**
 * frontend/src/shared/hooks/useObjectActions.tsx
 *
 * Shared hook and utility for building context menu / actions menu items for Kubernetes objects.
 * Used by both GridTable context menus and Object Panel actions menus.
 */

import { useMemo } from 'react';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import {
  OpenIcon,
  RestartIcon,
  ScaleIcon,
  DeleteIcon,
  PortForwardIcon,
} from '@shared/components/icons/MenuIcons';

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
  // For workload-specific actions
  status?: string;
  ready?: string;
  // Whether a HorizontalPodAutoscaler targets this workload (disables manual scaling)
  hpaManaged?: boolean;
  // For Event-specific actions - the involved object reference (e.g., "Pod/my-pod")
  involvedObject?: string;
}

// Action handlers
export interface ObjectActionHandlers {
  onOpen?: () => void;
  onRestart?: () => void;
  onScale?: () => void;
  onDelete?: () => void;
  onPortForward?: () => void;
  // CronJob actions
  onTrigger?: () => void;
  onSuspendToggle?: () => void;
  // Event actions - view the involved object
  onViewInvolvedObject?: () => void;
}

// Permission status type (matches what useUserPermissions returns)
export interface PermissionStatus {
  allowed: boolean;
  pending: boolean;
}

// Kinds that support each action
export const RESTARTABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
export const SCALABLE_KINDS = ['Deployment', 'StatefulSet', 'ReplicaSet'];
export const PORT_FORWARDABLE_KINDS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Service'];

// Options for building action items
export interface BuildObjectActionsOptions {
  object: ObjectActionData;
  context: 'gridtable' | 'object-panel';
  handlers: ObjectActionHandlers;
  permissions: {
    restart?: PermissionStatus | null;
    scale?: PermissionStatus | null;
    delete?: PermissionStatus | null;
    portForward?: PermissionStatus | null;
  };
  actionLoading?: boolean;
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

  const {
    restart: restartStatus,
    scale: scaleStatus,
    delete: deleteStatus,
    portForward: portForwardStatus,
  } = permissions;

  // Permission pending header
  const anyPending =
    restartStatus?.pending ||
    scaleStatus?.pending ||
    deleteStatus?.pending ||
    portForwardStatus?.pending;

  if (anyPending) {
    menuItems.push({ header: true, label: 'Awaiting permissions...' });
  }

  // Open - only for gridtable context
  if (context === 'gridtable' && handlers.onOpen) {
    menuItems.push({
      label: 'Open',
      icon: <OpenIcon />,
      onClick: handlers.onOpen,
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

  // Scale – disabled with explanation when managed by an HPA
  if (
    SCALABLE_KINDS.includes(normalizedKind) &&
    scaleStatus?.allowed &&
    !scaleStatus.pending
  ) {
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
  if (
    PORT_FORWARDABLE_KINDS.includes(normalizedKind) &&
    portForwardStatus?.allowed &&
    !portForwardStatus.pending &&
    handlers.onPortForward
  ) {
    menuItems.push({
      label: 'Port Forward',
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

    // Get permissions from the map
    const clusterId = object.clusterId ?? undefined;
    const restartStatus =
      permissionMap.get(getPermissionKey(normalizedKind, 'patch', namespace, null, clusterId)) ??
      null;
    const scaleStatus =
      permissionMap.get(
        getPermissionKey(normalizedKind, 'update', namespace, 'scale', clusterId)
      ) ?? null;
    const deleteStatus =
      permissionMap.get(getPermissionKey(object.kind, 'delete', namespace, null, clusterId)) ??
      null;
    // Port forward requires create permission on pods/portforward subresource
    const portForwardStatus =
      permissionMap.get(getPermissionKey('Pod', 'create', namespace, 'portforward', clusterId)) ??
      null;

    return buildObjectActionItems({
      object,
      context,
      handlers,
      permissions: {
        restart: restartStatus,
        scale: scaleStatus,
        delete: deleteStatus,
        portForward: portForwardStatus,
      },
      actionLoading,
    });
  }, [object, context, handlers, actionLoading, permissionMap]);

  return items;
}
