/**
 * frontend/src/shared/actions/objectActionContract.ts
 *
 * Shared contract for frontend object actions, backend RunObjectAction strings,
 * permission descriptors, payload fields, labels, and denied reason metadata.
 */

import type { CapabilityDescriptor } from '@/core/capabilities';

export const OBJECT_ACTION_IDS = {
  viewDetails: 'view-details',
  viewMap: 'view-map',
  goToTable: 'go-to-table',
  diff: 'diff',
  viewInvolvedObject: 'view-involved-object',
  triggerNow: 'trigger-now',
  suspend: 'suspend',
  resume: 'resume',
  restart: 'restart',
  rollback: 'rollback',
  scale: 'scale',
  scaleToZero: 'scale-to-zero',
  resumeFromZero: 'resume-from-zero',
  portForward: 'port-forward',
  cordon: 'cordon',
  uncordon: 'uncordon',
  drain: 'drain',
  delete: 'delete',
} as const;

export type ObjectActionId = (typeof OBJECT_ACTION_IDS)[keyof typeof OBJECT_ACTION_IDS];

export const OBJECT_ACTIONS = {
  delete: 'delete',
  restart: 'restart',
  scale: 'scale',
  trigger: 'trigger',
  suspend: 'suspend',
  cordon: 'cordon',
  uncordon: 'uncordon',
  startDrain: 'startDrain',
  startPortForward: 'startPortForward',
  createDebugContainer: 'createDebugContainer',
  rollback: 'rollback',
} as const;

export type ObjectActionName = (typeof OBJECT_ACTIONS)[keyof typeof OBJECT_ACTIONS];

export const MUTATING_OBJECT_ACTION_IDS = [
  OBJECT_ACTION_IDS.restart,
  OBJECT_ACTION_IDS.rollback,
  OBJECT_ACTION_IDS.scale,
  OBJECT_ACTION_IDS.scaleToZero,
  OBJECT_ACTION_IDS.resumeFromZero,
  OBJECT_ACTION_IDS.triggerNow,
  OBJECT_ACTION_IDS.suspend,
  OBJECT_ACTION_IDS.resume,
  OBJECT_ACTION_IDS.portForward,
  OBJECT_ACTION_IDS.cordon,
  OBJECT_ACTION_IDS.uncordon,
  OBJECT_ACTION_IDS.drain,
  OBJECT_ACTION_IDS.delete,
] as const satisfies readonly ObjectActionId[];

export type MutatingObjectActionId = (typeof MUTATING_OBJECT_ACTION_IDS)[number];

export type ObjectActionPayloadField =
  'replicas' | 'suspend' | 'drainOptions' | 'portForward' | 'debugContainer' | 'revision';

export type ObjectActionPermissionSlot =
  | 'restart'
  | 'rollback'
  | 'scale'
  | 'trigger'
  | 'suspend'
  | 'delete'
  | 'portForward'
  | 'cordon'
  | 'drain';

export interface ObjectActionIdentitySource {
  clusterId?: string | null;
  group?: string | null;
  version?: string | null;
  kind?: string | null;
  namespace?: string | null;
  name?: string | null;
}

export interface ObjectActionPermissionDescriptor {
  id: string;
  actionId: MutatingObjectActionId;
  slot: ObjectActionPermissionSlot;
  clusterId?: string;
  group?: string;
  version?: string;
  resourceKind: string;
  verb: string;
  namespace?: string;
  name?: string;
  subresource?: string;
}

interface ObjectActionRunContract {
  actionId: MutatingObjectActionId;
  backendAction: ObjectActionName;
  payloadFields: readonly ObjectActionPayloadField[];
  capabilityId: string;
  permissionSlot: ObjectActionPermissionSlot;
  frontendPermission: string;
  backendPermission: string;
  deniedReason: string;
  buildPermissionDescriptor: (
    source: ObjectActionIdentitySource,
    actionId: MutatingObjectActionId
  ) => ObjectActionPermissionDescriptor | null;
}

const trimOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

const sourceNamespace = (source: ObjectActionIdentitySource): string | undefined =>
  trimOptional(source.namespace);

const sourceName = (source: ObjectActionIdentitySource): string | undefined =>
  trimOptional(source.name);

const sourceClusterId = (source: ObjectActionIdentitySource): string | undefined =>
  trimOptional(source.clusterId);

const sourceGroup = (source: ObjectActionIdentitySource): string | undefined => {
  if (source.group === null || source.group === undefined) return undefined;
  return source.group.trim();
};

const sourceVersion = (source: ObjectActionIdentitySource): string | undefined =>
  trimOptional(source.version);

const sourceKind = (
  source: ObjectActionIdentitySource,
  fallbackKind?: string
): string | undefined => trimOptional(source.kind) ?? fallbackKind;

const targetObjectDescriptor = ({
  source,
  actionId,
  slot,
  capabilityId,
  verb,
  subresource,
  kind,
}: {
  source: ObjectActionIdentitySource;
  actionId: MutatingObjectActionId;
  slot: ObjectActionPermissionSlot;
  capabilityId: string;
  verb: string;
  subresource?: string;
  kind?: string;
}): ObjectActionPermissionDescriptor | null => {
  const resourceKind = sourceKind(source, kind);
  if (!resourceKind) return null;
  return {
    id: capabilityId,
    actionId,
    slot,
    clusterId: sourceClusterId(source),
    group: sourceGroup(source),
    version: sourceVersion(source),
    resourceKind,
    verb,
    namespace: sourceNamespace(source),
    name: sourceName(source),
    subresource,
  };
};

const cronJobTriggerDescriptor = (
  source: ObjectActionIdentitySource,
  actionId: MutatingObjectActionId
): ObjectActionPermissionDescriptor => ({
  id: 'trigger',
  actionId,
  slot: 'trigger',
  clusterId: sourceClusterId(source),
  group: 'batch',
  version: 'v1',
  resourceKind: 'Job',
  verb: 'create',
  namespace: sourceNamespace(source),
});

const cronJobSuspendDescriptor = (
  source: ObjectActionIdentitySource,
  actionId: MutatingObjectActionId
): ObjectActionPermissionDescriptor => ({
  id: 'suspend',
  actionId,
  slot: 'suspend',
  clusterId: sourceClusterId(source),
  group: 'batch',
  version: 'v1',
  resourceKind: 'CronJob',
  verb: 'patch',
  namespace: sourceNamespace(source),
  name: sourceName(source),
});

const portForwardDescriptor = (
  source: ObjectActionIdentitySource,
  actionId: MutatingObjectActionId
): ObjectActionPermissionDescriptor => ({
  id: 'port-forward',
  actionId,
  slot: 'portForward',
  clusterId: sourceClusterId(source),
  group: '',
  version: 'v1',
  resourceKind: 'Pod',
  verb: 'create',
  namespace: sourceNamespace(source),
  subresource: 'portforward',
});

const scaleDescriptor = (
  source: ObjectActionIdentitySource,
  actionId: MutatingObjectActionId
): ObjectActionPermissionDescriptor | null =>
  targetObjectDescriptor({
    source,
    actionId,
    slot: 'scale',
    capabilityId: 'scale',
    verb: 'update',
    subresource: 'scale',
  });

const nodePermissionDescriptor = (
  id: string,
  actionId: MutatingObjectActionId,
  slot: ObjectActionPermissionSlot,
  source: ObjectActionIdentitySource,
  verb: string
): ObjectActionPermissionDescriptor => ({
  id,
  actionId,
  slot,
  clusterId: sourceClusterId(source),
  group: '',
  version: 'v1',
  resourceKind: 'Node',
  verb,
});

const OBJECT_ACTION_RUN_CONTRACTS: Record<MutatingObjectActionId, ObjectActionRunContract> = {
  [OBJECT_ACTION_IDS.restart]: {
    actionId: OBJECT_ACTION_IDS.restart,
    backendAction: OBJECT_ACTIONS.restart,
    payloadFields: [],
    capabilityId: 'restart',
    permissionSlot: 'restart',
    frontendPermission: 'target workload patch',
    backendPermission: 'resourcePermissionCheck(target-workload, patch)',
    deniedReason: 'restart permission state',
    buildPermissionDescriptor: (source, actionId) =>
      targetObjectDescriptor({
        source,
        actionId,
        slot: 'restart',
        capabilityId: 'restart',
        verb: 'patch',
      }),
  },
  [OBJECT_ACTION_IDS.rollback]: {
    actionId: OBJECT_ACTION_IDS.rollback,
    backendAction: OBJECT_ACTIONS.rollback,
    payloadFields: ['revision'],
    capabilityId: 'rollback',
    permissionSlot: 'rollback',
    frontendPermission: 'target workload update',
    backendPermission: 'resourcePermissionCheck(target-workload, update)',
    deniedReason: 'rollback permission state',
    buildPermissionDescriptor: (source, actionId) =>
      targetObjectDescriptor({
        source,
        actionId,
        slot: 'rollback',
        capabilityId: 'rollback',
        verb: 'update',
      }),
  },
  [OBJECT_ACTION_IDS.scale]: {
    actionId: OBJECT_ACTION_IDS.scale,
    backendAction: OBJECT_ACTIONS.scale,
    payloadFields: ['replicas'],
    capabilityId: 'scale',
    permissionSlot: 'scale',
    frontendPermission: 'target workload scale update',
    backendPermission: 'resourcePermissionCheck(target-workload-scale, update)',
    deniedReason: 'scale permission state',
    buildPermissionDescriptor: scaleDescriptor,
  },
  [OBJECT_ACTION_IDS.scaleToZero]: {
    actionId: OBJECT_ACTION_IDS.scaleToZero,
    backendAction: OBJECT_ACTIONS.scale,
    payloadFields: ['replicas'],
    capabilityId: 'scale',
    permissionSlot: 'scale',
    frontendPermission: 'target workload scale update',
    backendPermission: 'resourcePermissionCheck(target-workload-scale, update)',
    deniedReason: 'scale permission state',
    buildPermissionDescriptor: scaleDescriptor,
  },
  [OBJECT_ACTION_IDS.resumeFromZero]: {
    actionId: OBJECT_ACTION_IDS.resumeFromZero,
    backendAction: OBJECT_ACTIONS.scale,
    payloadFields: ['replicas'],
    capabilityId: 'scale',
    permissionSlot: 'scale',
    frontendPermission: 'target workload scale update',
    backendPermission: 'resourcePermissionCheck(target-workload-scale, update)',
    deniedReason: 'scale permission state',
    buildPermissionDescriptor: scaleDescriptor,
  },
  [OBJECT_ACTION_IDS.triggerNow]: {
    actionId: OBJECT_ACTION_IDS.triggerNow,
    backendAction: OBJECT_ACTIONS.trigger,
    payloadFields: [],
    capabilityId: 'trigger',
    permissionSlot: 'trigger',
    frontendPermission: 'batch/v1 Job create',
    backendPermission: 'resourcePermissionCheck(job, create)',
    deniedReason: 'trigger permission state',
    buildPermissionDescriptor: cronJobTriggerDescriptor,
  },
  [OBJECT_ACTION_IDS.suspend]: {
    actionId: OBJECT_ACTION_IDS.suspend,
    backendAction: OBJECT_ACTIONS.suspend,
    payloadFields: ['suspend'],
    capabilityId: 'suspend',
    permissionSlot: 'suspend',
    frontendPermission: 'batch/v1 CronJob patch',
    backendPermission: 'resourcePermissionCheck(cronjob, patch)',
    deniedReason: 'suspend permission state',
    buildPermissionDescriptor: cronJobSuspendDescriptor,
  },
  [OBJECT_ACTION_IDS.resume]: {
    actionId: OBJECT_ACTION_IDS.resume,
    backendAction: OBJECT_ACTIONS.suspend,
    payloadFields: ['suspend'],
    capabilityId: 'suspend',
    permissionSlot: 'suspend',
    frontendPermission: 'batch/v1 CronJob patch',
    backendPermission: 'resourcePermissionCheck(cronjob, patch)',
    deniedReason: 'suspend permission state',
    buildPermissionDescriptor: cronJobSuspendDescriptor,
  },
  [OBJECT_ACTION_IDS.portForward]: {
    actionId: OBJECT_ACTION_IDS.portForward,
    backendAction: OBJECT_ACTIONS.startPortForward,
    payloadFields: ['portForward'],
    capabilityId: 'port-forward',
    permissionSlot: 'portForward',
    frontendPermission: 'core/v1 Pod portforward create',
    backendPermission: 'resourcePermissionCheck(pod-portforward, create)',
    deniedReason: 'port-forward permission state',
    buildPermissionDescriptor: portForwardDescriptor,
  },
  [OBJECT_ACTION_IDS.cordon]: {
    actionId: OBJECT_ACTION_IDS.cordon,
    backendAction: OBJECT_ACTIONS.cordon,
    payloadFields: [],
    capabilityId: 'cordon',
    permissionSlot: 'cordon',
    frontendPermission: 'core/v1 Node get and patch',
    backendPermission:
      'resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch)',
    deniedReason: 'cordon permission state',
    buildPermissionDescriptor: (source, actionId) =>
      nodePermissionDescriptor('node-patch', actionId, 'cordon', source, 'patch'),
  },
  [OBJECT_ACTION_IDS.uncordon]: {
    actionId: OBJECT_ACTION_IDS.uncordon,
    backendAction: OBJECT_ACTIONS.uncordon,
    payloadFields: [],
    capabilityId: 'cordon',
    permissionSlot: 'cordon',
    frontendPermission: 'core/v1 Node get and patch',
    backendPermission:
      'resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch)',
    deniedReason: 'cordon permission state',
    buildPermissionDescriptor: (source, actionId) =>
      nodePermissionDescriptor('node-patch', actionId, 'cordon', source, 'patch'),
  },
  [OBJECT_ACTION_IDS.drain]: {
    actionId: OBJECT_ACTION_IDS.drain,
    backendAction: OBJECT_ACTIONS.startDrain,
    payloadFields: ['drainOptions'],
    capabilityId: 'drain',
    permissionSlot: 'drain',
    frontendPermission: 'core/v1 Node get+patch and Pod eviction create or Pod delete',
    backendPermission:
      'resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch) and resourcePermissionCheck(pod-eviction, create optional) and resourcePermissionCheck(pod-delete, delete optional)',
    deniedReason: 'drain permission state',
    buildPermissionDescriptor: (source, actionId) =>
      nodePermissionDescriptor('node-patch', actionId, 'drain', source, 'patch'),
  },
  [OBJECT_ACTION_IDS.delete]: {
    actionId: OBJECT_ACTION_IDS.delete,
    backendAction: OBJECT_ACTIONS.delete,
    payloadFields: [],
    capabilityId: 'delete',
    permissionSlot: 'delete',
    frontendPermission: 'target object delete',
    backendPermission: 'resourcePermissionCheck(target, delete)',
    deniedReason: 'delete permission state',
    buildPermissionDescriptor: (source, actionId) =>
      targetObjectDescriptor({
        source,
        actionId,
        slot: 'delete',
        capabilityId: 'delete',
        verb: 'delete',
      }),
  },
};

const OBJECT_ACTION_LABELS: Record<ObjectActionId, string> = {
  [OBJECT_ACTION_IDS.viewDetails]: 'Open Details',
  [OBJECT_ACTION_IDS.viewMap]: 'Open Map',
  [OBJECT_ACTION_IDS.goToTable]: 'Go to Table View',
  [OBJECT_ACTION_IDS.diff]: 'Diff',
  [OBJECT_ACTION_IDS.viewInvolvedObject]: 'View Object',
  [OBJECT_ACTION_IDS.triggerNow]: 'Trigger Now',
  [OBJECT_ACTION_IDS.suspend]: 'Suspend',
  [OBJECT_ACTION_IDS.resume]: 'Resume',
  [OBJECT_ACTION_IDS.restart]: 'Restart',
  [OBJECT_ACTION_IDS.rollback]: 'Rollback',
  [OBJECT_ACTION_IDS.scale]: 'Scale',
  [OBJECT_ACTION_IDS.scaleToZero]: 'Scale to 0',
  [OBJECT_ACTION_IDS.resumeFromZero]: 'Resume from 0',
  [OBJECT_ACTION_IDS.portForward]: 'Port Forward',
  [OBJECT_ACTION_IDS.cordon]: 'Cordon',
  [OBJECT_ACTION_IDS.uncordon]: 'Uncordon',
  [OBJECT_ACTION_IDS.drain]: 'Drain',
  [OBJECT_ACTION_IDS.delete]: 'Delete',
};

export const objectActionLabel = (id: ObjectActionId): string => OBJECT_ACTION_LABELS[id];

export const objectActionInvolvedObjectLabel = (kind: string): string => `View ${kind}`;

export const objectActionContract = (actionId: MutatingObjectActionId): ObjectActionRunContract =>
  OBJECT_ACTION_RUN_CONTRACTS[actionId];

export const objectActionBackendAction = (actionId: MutatingObjectActionId): ObjectActionName =>
  objectActionContract(actionId).backendAction;

export const objectActionPayloadFields = (
  actionId: MutatingObjectActionId
): readonly ObjectActionPayloadField[] => objectActionContract(actionId).payloadFields;

export const buildObjectActionPermissionDescriptor = (
  actionId: MutatingObjectActionId,
  source: ObjectActionIdentitySource
): ObjectActionPermissionDescriptor | null =>
  objectActionContract(actionId).buildPermissionDescriptor(source, actionId);

export const buildObjectActionCapabilityDescriptor = (
  actionId: MutatingObjectActionId,
  source: ObjectActionIdentitySource
): CapabilityDescriptor | null => {
  const descriptor = buildObjectActionPermissionDescriptor(actionId, source);
  if (!descriptor) return null;
  return {
    id: descriptor.id,
    clusterId: descriptor.clusterId,
    verb: descriptor.verb,
    group: descriptor.group,
    version: descriptor.version,
    resourceKind: descriptor.resourceKind,
    namespace: descriptor.namespace,
    name: descriptor.name,
    subresource: descriptor.subresource,
  };
};

export const buildNodeActionPermissionDescriptorMap = (
  source: ObjectActionIdentitySource
): {
  nodeGet: ObjectActionPermissionDescriptor;
  nodePatch: ObjectActionPermissionDescriptor;
  podEvictionCreate: ObjectActionPermissionDescriptor;
  podDelete: ObjectActionPermissionDescriptor;
} => {
  const clusterId = sourceClusterId(source);
  return {
    nodeGet: {
      id: 'node-get',
      actionId: OBJECT_ACTION_IDS.cordon,
      slot: 'cordon',
      clusterId,
      group: '',
      version: 'v1',
      resourceKind: 'Node',
      verb: 'get',
    },
    nodePatch: {
      id: 'node-patch',
      actionId: OBJECT_ACTION_IDS.cordon,
      slot: 'cordon',
      clusterId,
      group: '',
      version: 'v1',
      resourceKind: 'Node',
      verb: 'patch',
    },
    podEvictionCreate: {
      id: 'pod-eviction-create',
      actionId: OBJECT_ACTION_IDS.drain,
      slot: 'drain',
      clusterId,
      group: '',
      version: 'v1',
      resourceKind: 'Pod',
      verb: 'create',
      subresource: 'eviction',
    },
    podDelete: {
      id: 'pod-delete',
      actionId: OBJECT_ACTION_IDS.drain,
      slot: 'drain',
      clusterId,
      group: '',
      version: 'v1',
      resourceKind: 'Pod',
      verb: 'delete',
    },
  };
};
