/**
 * frontend/src/shared/actions/objectActionPolicy.ts
 *
 * Centralizes object-action availability rules so menus, controllers, and
 * tests share one policy for supported kinds, permission state, and row facts.
 */

import type { ResourceLink } from '@core/refresh/types';
import {
  isPortForwardTargetGVKSupported,
  lookupPortForwardTargetCapability,
} from '@modules/port-forward/targetCapabilities';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { OBJECT_ACTION_IDS, type ObjectActionId } from './objectActionContract';

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
  desiredReplicas?: number;
  // Whether the target exposes any forwardable TCP ports.
  portForwardAvailable?: boolean;
  // Whether a HorizontalPodAutoscaler targets this workload. `null`/`undefined`
  // means the action surface has not established HPA ownership yet.
  hpaManaged?: boolean | null;
  // Node-only: when true the cordon action toggles to "Uncordon".
  unschedulable?: boolean;
  // For Event-specific actions - the involved object reference (e.g., "Pod/my-pod")
  involvedObject?: string;
  involvedObjectRef?: ResourceLink;
}

export interface PermissionStatus {
  allowed: boolean;
  pending: boolean;
}

export interface ObjectActionPermissionStatuses {
  restart?: PermissionStatus | null;
  rollback?: PermissionStatus | null;
  scale?: PermissionStatus | null;
  trigger?: PermissionStatus | null;
  suspend?: PermissionStatus | null;
  delete?: PermissionStatus | null;
  portForward?: PermissionStatus | null;
  cordon?: PermissionStatus | null;
  drain?: PermissionStatus | null;
}

export interface ObjectActionHandlerAvailability {
  restart?: boolean;
  rollback?: boolean;
  scale?: boolean;
  scaleToZero?: boolean;
  resumeFromZero?: boolean;
  delete?: boolean;
  portForward?: boolean;
  cordon?: boolean;
  drain?: boolean;
  trigger?: boolean;
  suspendToggle?: boolean;
}

export interface PortForwardAvailability {
  show: boolean;
  enabled: boolean;
  actionId: typeof OBJECT_ACTION_IDS.portForward;
}

export interface ObjectActionPolicy {
  normalizedKind: string;
  portForward: PortForwardAvailability;
  anyPending: boolean;
  hasActionSection: boolean;
  triggerEnabled: boolean;
  triggerDisabled: boolean;
  suspendActionId: typeof OBJECT_ACTION_IDS.suspend | typeof OBJECT_ACTION_IDS.resume | null;
  restartEnabled: boolean;
  rollbackEnabled: boolean;
  scaleActionId:
    | typeof OBJECT_ACTION_IDS.scale
    | typeof OBJECT_ACTION_IDS.scaleToZero
    | typeof OBJECT_ACTION_IDS.resumeFromZero
    | null;
  scaleActionDisabled: boolean;
  cordonActionId: typeof OBJECT_ACTION_IDS.cordon | typeof OBJECT_ACTION_IDS.uncordon | null;
  drainEnabled: boolean;
  portForwardEnabled: boolean;
  deleteEnabled: boolean;
}

const RESTARTABLE_KINDS: readonly string[] = ['Deployment', 'StatefulSet', 'DaemonSet'];
const ROLLBACKABLE_KINDS: readonly string[] = ['Deployment', 'StatefulSet', 'DaemonSet'];
export const SCALABLE_KINDS: readonly string[] = ['Deployment', 'StatefulSet', 'ReplicaSet'];
const CORDONABLE_KINDS: readonly string[] = ['Node'];
const DRAINABLE_KINDS: readonly string[] = ['Node'];

const permissionAllows = (status: PermissionStatus | null | undefined): boolean =>
  Boolean(status?.allowed && !status.pending);

const resolvePortForwardAvailability = (
  object: ObjectActionData,
  handlers: ObjectActionHandlerAvailability
): PortForwardAvailability => {
  const normalizedKind = normalizeKind(object.kind);
  const actionId = OBJECT_ACTION_IDS.portForward;

  if (!lookupPortForwardTargetCapability(normalizedKind) || !handlers.portForward) {
    return { show: false, enabled: false, actionId };
  }

  const builtin = resolveBuiltinGroupVersion(object.kind);
  const group = object.group ?? builtin.group ?? '';
  const version = object.version ?? builtin.version ?? '';

  if (!object.clusterId || !object.namespace) {
    return { show: true, enabled: false, actionId };
  }

  if (
    !isPortForwardTargetGVKSupported({
      kind: normalizedKind,
      group,
      version,
    })
  ) {
    return { show: true, enabled: false, actionId };
  }

  if (object.portForwardAvailable === false) {
    return { show: true, enabled: false, actionId };
  }

  return { show: true, enabled: true, actionId };
};

const extractDesiredReplicas = (object: ObjectActionData): number | null => {
  if (typeof object.desiredReplicas === 'number' && Number.isFinite(object.desiredReplicas)) {
    return Math.max(0, object.desiredReplicas);
  }
  const ready = object.ready?.trim();
  if (!ready) {
    return null;
  }
  const segments = ready.split('/');
  const candidate = Number.parseInt(segments[segments.length - 1]?.trim() ?? '', 10);
  return Number.isFinite(candidate) ? Math.max(0, candidate) : null;
};

const includesKind = (kinds: readonly string[], kind: string): boolean => kinds.includes(kind);

export const resolveObjectActionPolicy = ({
  object,
  context,
  handlers,
  permissions,
  actionLoading = false,
}: {
  object: ObjectActionData;
  context: 'gridtable' | 'object-map' | 'object-panel';
  handlers: ObjectActionHandlerAvailability;
  permissions: ObjectActionPermissionStatuses;
  actionLoading?: boolean;
}): ObjectActionPolicy => {
  const normalizedKind = normalizeKind(object.kind);
  const isCronJob = normalizedKind === 'CronJob';
  const portForward = resolvePortForwardAvailability(object, handlers);

  const anyPending = Boolean(
    permissions.restart?.pending ||
      permissions.rollback?.pending ||
      permissions.scale?.pending ||
      permissions.trigger?.pending ||
      permissions.suspend?.pending ||
      permissions.delete?.pending ||
      permissions.portForward?.pending ||
      permissions.cordon?.pending ||
      permissions.drain?.pending
  );

  const triggerEnabled =
    isCronJob && Boolean(handlers.trigger) && permissionAllows(permissions.trigger);
  const triggerDisabled = object.status === 'Suspended' || actionLoading;

  const suspendActionId =
    isCronJob && handlers.suspendToggle && permissionAllows(permissions.suspend)
      ? object.status === 'Suspended'
        ? OBJECT_ACTION_IDS.resume
        : OBJECT_ACTION_IDS.suspend
      : null;

  const restartEnabled =
    includesKind(RESTARTABLE_KINDS, normalizedKind) &&
    Boolean(handlers.restart) &&
    permissionAllows(permissions.restart);

  const rollbackEnabled =
    includesKind(ROLLBACKABLE_KINDS, normalizedKind) &&
    Boolean(handlers.rollback) &&
    permissionAllows(permissions.rollback);

  const scaleAllowed =
    includesKind(SCALABLE_KINDS, normalizedKind) && permissionAllows(permissions.scale);
  const desiredReplicas = extractDesiredReplicas(object);
  const scaleActionId: ObjectActionPolicy['scaleActionId'] =
    scaleAllowed && object.hpaManaged === true
      ? desiredReplicas === 0
        ? OBJECT_ACTION_IDS.resumeFromZero
        : OBJECT_ACTION_IDS.scaleToZero
      : scaleAllowed && object.hpaManaged === false && handlers.scale
        ? OBJECT_ACTION_IDS.scale
        : null;
  const scaleActionDisabled = Boolean(
    actionLoading ||
      (scaleActionId === OBJECT_ACTION_IDS.scaleToZero && !handlers.scaleToZero) ||
      (scaleActionId === OBJECT_ACTION_IDS.resumeFromZero && !handlers.resumeFromZero)
  );

  const cordonActionId =
    includesKind(CORDONABLE_KINDS, normalizedKind) &&
    handlers.cordon &&
    permissionAllows(permissions.cordon)
      ? object.unschedulable
        ? OBJECT_ACTION_IDS.uncordon
        : OBJECT_ACTION_IDS.cordon
      : null;

  const drainEnabled =
    includesKind(DRAINABLE_KINDS, normalizedKind) &&
    Boolean(handlers.drain) &&
    permissionAllows(permissions.drain);

  const portForwardEnabled =
    portForward.show && portForward.enabled && permissionAllows(permissions.portForward);

  const deleteEnabled = Boolean(handlers.delete) && permissionAllows(permissions.delete);

  const hasActionSection =
    anyPending ||
    isCronJob ||
    (includesKind(RESTARTABLE_KINDS, normalizedKind) && Boolean(handlers.restart)) ||
    (includesKind(ROLLBACKABLE_KINDS, normalizedKind) && Boolean(handlers.rollback)) ||
    (includesKind(SCALABLE_KINDS, normalizedKind) &&
      (object.hpaManaged === true || (object.hpaManaged === false && Boolean(handlers.scale)))) ||
    (includesKind(CORDONABLE_KINDS, normalizedKind) && Boolean(handlers.cordon)) ||
    (includesKind(DRAINABLE_KINDS, normalizedKind) && Boolean(handlers.drain)) ||
    portForward.show ||
    (context !== 'gridtable' && Boolean(handlers.delete));

  return {
    normalizedKind,
    portForward,
    anyPending,
    hasActionSection,
    triggerEnabled,
    triggerDisabled,
    suspendActionId,
    restartEnabled,
    rollbackEnabled,
    scaleActionId,
    scaleActionDisabled,
    cordonActionId,
    drainEnabled,
    portForwardEnabled,
    deleteEnabled,
  };
};

export const objectActionPolicyIds = (policy: ObjectActionPolicy): ObjectActionId[] => {
  const ids: Array<ObjectActionId | null> = [
    policy.triggerEnabled ? OBJECT_ACTION_IDS.triggerNow : null,
    policy.suspendActionId,
    policy.restartEnabled ? OBJECT_ACTION_IDS.restart : null,
    policy.rollbackEnabled ? OBJECT_ACTION_IDS.rollback : null,
    policy.scaleActionId,
    policy.cordonActionId,
    policy.drainEnabled ? OBJECT_ACTION_IDS.drain : null,
    policy.portForward.show ? policy.portForward.actionId : null,
    policy.deleteEnabled ? OBJECT_ACTION_IDS.delete : null,
  ];
  return ids.filter((id): id is ObjectActionId => Boolean(id));
};
