/**
 * frontend/src/shared/actions/objectActionPolicy.ts
 *
 * Centralizes object-action availability rules so menus, controllers, and
 * tests share one policy for supported kinds, permission state, and row facts.
 */

import type { ResourceLink } from '@core/refresh/types';
import { lookupObjectActionKindCapability } from './objectActionCapabilities';
import { OBJECT_ACTION_IDS, type ObjectActionId } from './objectActionContract';

export interface ObjectActionData {
  kind: string;
  name: string;
  namespace?: string;
  clusterId: string;
  clusterName?: string;
  // API group/version for the object's kind. Required to look up CRD
  // permissions correctly: getPermissionKey only auto-resolves built-in
  // GVK from a static table, so CRD callers must thread these through
  // or the lookup key won't match the spec-emit key from
  // queryPermissionChecks and the Delete action silently disappears.
  group: string;
  version: string;
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

const permissionAllows = (status: PermissionStatus | null | undefined): boolean =>
  Boolean(status?.allowed && !status.pending);

const lookupObjectCapability = (object: Pick<ObjectActionData, 'group' | 'version' | 'kind'>) => {
  return lookupObjectActionKindCapability({
    group: object.group,
    version: object.version,
    kind: object.kind,
  });
};

const resolvePortForwardAvailability = (
  object: ObjectActionData,
  handlers: ObjectActionHandlerAvailability,
  capability: ReturnType<typeof lookupObjectCapability>
): PortForwardAvailability => {
  const actionId = OBJECT_ACTION_IDS.portForward;

  if (!capability?.portForward || !handlers.portForward) {
    return { show: false, enabled: false, actionId };
  }

  if (!object.clusterId.trim() || !object.namespace) {
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

const hasPendingPermission = (permissions: ObjectActionPermissionStatuses): boolean =>
  Boolean(
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

const resolveSuspendActionId = (
  isCronJob: boolean,
  object: ObjectActionData,
  handlers: ObjectActionHandlerAvailability,
  permissions: ObjectActionPermissionStatuses
): ObjectActionPolicy['suspendActionId'] => {
  if (!isCronJob || !handlers.suspendToggle || !permissionAllows(permissions.suspend)) {
    return null;
  }
  return object.status === 'Suspended' ? OBJECT_ACTION_IDS.resume : OBJECT_ACTION_IDS.suspend;
};

const resolveScaleActionId = (
  capability: ReturnType<typeof lookupObjectCapability>,
  object: ObjectActionData,
  handlers: ObjectActionHandlerAvailability,
  permissions: ObjectActionPermissionStatuses
): ObjectActionPolicy['scaleActionId'] => {
  const scaleAllowed = Boolean(capability?.scale) && permissionAllows(permissions.scale);
  if (!scaleAllowed) {
    return null;
  }
  if (object.hpaManaged === true) {
    return extractDesiredReplicas(object) === 0
      ? OBJECT_ACTION_IDS.resumeFromZero
      : OBJECT_ACTION_IDS.scaleToZero;
  }
  return object.hpaManaged === false && handlers.scale ? OBJECT_ACTION_IDS.scale : null;
};

const isScaleActionDisabled = (
  actionId: ObjectActionPolicy['scaleActionId'],
  handlers: ObjectActionHandlerAvailability,
  actionLoading: boolean
): boolean =>
  Boolean(
    actionLoading ||
      (actionId === OBJECT_ACTION_IDS.scaleToZero && !handlers.scaleToZero) ||
      (actionId === OBJECT_ACTION_IDS.resumeFromZero && !handlers.resumeFromZero)
  );

const resolveCordonActionId = (
  capability: ReturnType<typeof lookupObjectCapability>,
  object: ObjectActionData,
  handlers: ObjectActionHandlerAvailability,
  permissions: ObjectActionPermissionStatuses
): ObjectActionPolicy['cordonActionId'] => {
  if (!capability?.cordon || !handlers.cordon || !permissionAllows(permissions.cordon)) {
    return null;
  }
  return object.unschedulable ? OBJECT_ACTION_IDS.uncordon : OBJECT_ACTION_IDS.cordon;
};

const hasActionSection = ({
  capability,
  context,
  object,
  handlers,
  portForward,
  anyPending,
  isCronJob,
}: {
  capability: ReturnType<typeof lookupObjectCapability>;
  context: 'gridtable' | 'object-map' | 'object-panel';
  object: ObjectActionData;
  handlers: ObjectActionHandlerAvailability;
  portForward: PortForwardAvailability;
  anyPending: boolean;
  isCronJob: boolean;
}): boolean =>
  Boolean(
    anyPending ||
      isCronJob ||
      (capability?.restart && handlers.restart) ||
      (capability?.rollback && handlers.rollback) ||
      (capability?.scale &&
        (object.hpaManaged === true || (object.hpaManaged === false && handlers.scale))) ||
      (capability?.cordon && handlers.cordon) ||
      (capability?.drain && handlers.drain) ||
      portForward.show ||
      (context !== 'gridtable' && handlers.delete)
  );

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
  const capability = lookupObjectCapability(object);
  const normalizedKind = capability?.kind ?? object.kind;
  const isCronJob = Boolean(capability?.trigger || capability?.suspend);
  const portForward = resolvePortForwardAvailability(object, handlers, capability);
  const anyPending = hasPendingPermission(permissions);
  const triggerEnabled =
    isCronJob && Boolean(handlers.trigger) && permissionAllows(permissions.trigger);
  const triggerDisabled = object.status === 'Suspended' || actionLoading;
  const suspendActionId = resolveSuspendActionId(isCronJob, object, handlers, permissions);
  const restartEnabled =
    Boolean(capability?.restart) &&
    Boolean(handlers.restart) &&
    permissionAllows(permissions.restart);

  const rollbackEnabled =
    Boolean(capability?.rollback) &&
    Boolean(handlers.rollback) &&
    permissionAllows(permissions.rollback);
  const scaleActionId = resolveScaleActionId(capability, object, handlers, permissions);
  const scaleActionDisabled = isScaleActionDisabled(scaleActionId, handlers, actionLoading);
  const cordonActionId = resolveCordonActionId(capability, object, handlers, permissions);
  const drainEnabled =
    Boolean(capability?.drain) && Boolean(handlers.drain) && permissionAllows(permissions.drain);
  const portForwardEnabled =
    portForward.show && portForward.enabled && permissionAllows(permissions.portForward);
  const deleteEnabled = Boolean(handlers.delete) && permissionAllows(permissions.delete);

  return {
    normalizedKind,
    portForward,
    anyPending,
    hasActionSection: hasActionSection({
      capability,
      context,
      object,
      handlers,
      portForward,
      anyPending,
      isCronJob,
    }),
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
