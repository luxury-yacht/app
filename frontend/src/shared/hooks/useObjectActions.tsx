/**
 * frontend/src/shared/hooks/useObjectActions.tsx
 *
 * Shared hook for building context menu / actions menu items for Kubernetes objects.
 * Used by both GridTable context menus and Object Panel actions menus.
 */

import React, { useCallback, useMemo } from 'react';
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

function normalizeKind(kind: string): string {
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
}

// Action handlers
export interface ObjectActionHandlers {
  onOpen?: () => void;
  onRestart?: () => void;
  onScale?: () => void;
  onDelete?: () => void;
  onPortForward?: () => void;
  onTrigger?: () => void;
  onSuspendToggle?: () => void;
}

// Hook options
export interface UseObjectActionsOptions {
  object: ObjectActionData | null;
  context: 'gridtable' | 'object-panel';
  handlers: ObjectActionHandlers;
  // Loading states
  actionLoading?: boolean;
}

// Kinds that support each action
const RESTARTABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
const SCALABLE_KINDS = ['Deployment', 'StatefulSet', 'ReplicaSet'];
const PORT_FORWARDABLE_KINDS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Service'];
const DELETABLE_KINDS = [
  'Pod',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'CronJob',
  'ConfigMap',
  'Secret',
  'Service',
  'Ingress',
  'NetworkPolicy',
  'PersistentVolumeClaim',
  'ServiceAccount',
  'Role',
  'RoleBinding',
  'HelmRelease',
];

export function useObjectActions({
  object,
  context,
  handlers,
  actionLoading = false,
}: UseObjectActionsOptions): ContextMenuItem[] {
  const permissionMap = useUserPermissions();

  const items = useMemo(() => {
    if (!object) return [];

    const menuItems: ContextMenuItem[] = [];
    const normalizedKind = normalizeKind(object.kind);
    const namespace = object.namespace || '';

    // Check permissions
    const restartStatus = permissionMap.get(
      getPermissionKey(normalizedKind, 'patch', namespace)
    );
    const scaleStatus = permissionMap.get(
      getPermissionKey(normalizedKind, 'update', namespace, 'scale')
    );
    const deleteStatus = permissionMap.get(
      getPermissionKey(object.kind, 'delete', namespace)
    );

    // Permission pending header
    const anyPending =
      restartStatus?.pending ||
      scaleStatus?.pending ||
      deleteStatus?.pending;

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

    // Scale
    if (
      SCALABLE_KINDS.includes(normalizedKind) &&
      scaleStatus?.allowed &&
      !scaleStatus.pending &&
      handlers.onScale
    ) {
      menuItems.push({
        label: 'Scale',
        icon: <ScaleIcon />,
        onClick: handlers.onScale,
        disabled: actionLoading,
      });
    }

    // Port Forward
    if (PORT_FORWARDABLE_KINDS.includes(normalizedKind) && handlers.onPortForward) {
      menuItems.push({
        label: 'Port Forward...',
        icon: <PortForwardIcon />,
        onClick: handlers.onPortForward,
        disabled: actionLoading,
      });
    }

    // Delete
    if (
      deleteStatus?.allowed &&
      !deleteStatus.pending &&
      handlers.onDelete
    ) {
      menuItems.push({
        label: 'Delete',
        icon: <DeleteIcon />,
        danger: true,
        onClick: handlers.onDelete,
        disabled: actionLoading,
      });
    }

    return menuItems;
  }, [object, context, handlers, actionLoading, permissionMap]);

  return items;
}
