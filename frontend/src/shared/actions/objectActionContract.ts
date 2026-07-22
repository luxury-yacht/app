/**
 * Frontend helpers for the backend-generated object-action catalog.
 */

import type { CapabilityDescriptor } from '@/core/capabilities';
import {
  type GeneratedObjectActionDefinition,
  type GeneratedObjectActionPermission,
  MUTATING_OBJECT_ACTION_IDS,
  type MutatingObjectActionId,
  NODE_ACTION_PERMISSIONS,
  OBJECT_ACTION_DEFINITIONS,
  OBJECT_ACTION_IDS,
  OBJECT_ACTIONS,
  type ObjectActionId,
  type ObjectActionName,
  type ObjectActionPayloadField,
  type ObjectActionPermissionSlot,
} from './objectActions.generated';

export type {
  MutatingObjectActionId,
  ObjectActionId,
  ObjectActionName,
  ObjectActionPayloadField,
  ObjectActionPermissionSlot,
};
export { MUTATING_OBJECT_ACTION_IDS, OBJECT_ACTION_IDS, OBJECT_ACTIONS };

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

export interface ObjectActionRunContract extends GeneratedObjectActionDefinition {
  actionId: MutatingObjectActionId;
  backendAction: ObjectActionName;
  payloadFields: readonly ObjectActionPayloadField[];
  permission: GeneratedObjectActionPermission;
  frontendPermission: string;
  backendPermission: string;
  deniedReason: string;
}

const trimOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

const sourceGroup = (source: ObjectActionIdentitySource): string | undefined =>
  source.group === null || source.group === undefined ? undefined : source.group.trim();

const requiredRunContract = (actionId: MutatingObjectActionId): ObjectActionRunContract => {
  const definition: GeneratedObjectActionDefinition = OBJECT_ACTION_DEFINITIONS[actionId];
  if (
    !definition.backendAction ||
    !definition.payloadFields ||
    !definition.permission ||
    !definition.frontendPermission ||
    !definition.backendPermission ||
    !definition.deniedReason
  ) {
    throw new Error(`Generated object-action contract is incomplete for ${actionId}`);
  }
  return { actionId, ...definition } as ObjectActionRunContract;
};

const buildPermissionDescriptor = (
  actionId: MutatingObjectActionId,
  permission: GeneratedObjectActionPermission,
  source: ObjectActionIdentitySource
): ObjectActionPermissionDescriptor | null => {
  const resourceKind = permission.resourceKind ?? trimOptional(source.kind);
  if (!resourceKind) {
    return null;
  }
  return {
    id: permission.id,
    actionId,
    slot: permission.slot,
    clusterId: trimOptional(source.clusterId),
    group: permission.group ?? sourceGroup(source),
    version: permission.version ?? trimOptional(source.version),
    resourceKind,
    verb: permission.verb,
    namespace: permission.namespace ? trimOptional(source.namespace) : undefined,
    name: permission.name ? trimOptional(source.name) : undefined,
    subresource: permission.subresource,
  };
};

export const objectActionLabel = (id: ObjectActionId): string =>
  OBJECT_ACTION_DEFINITIONS[id].label;

export const objectActionInvolvedObjectLabel = (kind: string): string => `View ${kind}`;

export const objectActionContract = (actionId: MutatingObjectActionId): ObjectActionRunContract =>
  requiredRunContract(actionId);

export const objectActionBackendAction = (actionId: MutatingObjectActionId): ObjectActionName =>
  requiredRunContract(actionId).backendAction;

export const objectActionPayloadFields = (
  actionId: MutatingObjectActionId
): readonly ObjectActionPayloadField[] => requiredRunContract(actionId).payloadFields;

export const buildObjectActionPermissionDescriptor = (
  actionId: MutatingObjectActionId,
  source: ObjectActionIdentitySource
): ObjectActionPermissionDescriptor | null =>
  buildPermissionDescriptor(actionId, requiredRunContract(actionId).permission, source);

export const buildObjectActionCapabilityDescriptor = (
  actionId: MutatingObjectActionId,
  source: ObjectActionIdentitySource
): CapabilityDescriptor | null => {
  const descriptor = buildObjectActionPermissionDescriptor(actionId, source);
  if (!descriptor) {
    return null;
  }
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
  const descriptors = NODE_ACTION_PERMISSIONS.map(({ permission }) => {
    const actionId =
      permission.slot === 'cordon' ? OBJECT_ACTION_IDS.cordon : OBJECT_ACTION_IDS.drain;
    return buildPermissionDescriptor(actionId, permission, source);
  });
  const [nodeGet, nodePatch, podEvictionCreate, podDelete] = descriptors;
  if (!nodeGet || !nodePatch || !podEvictionCreate || !podDelete) {
    throw new Error('Generated node action permission contract is incomplete');
  }
  return { nodeGet, nodePatch, podEvictionCreate, podDelete };
};
