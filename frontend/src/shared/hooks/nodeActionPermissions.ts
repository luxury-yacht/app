import type { PermissionStatus } from '@shared/hooks/useObjectActions';

export interface NodeActionPermissionInputs {
  nodeGet: PermissionStatus | null;
  nodePatch: PermissionStatus | null;
  podEvictionCreate: PermissionStatus | null;
  podDelete: PermissionStatus | null;
}

export interface NodeActionPermissionStatuses {
  cordon: PermissionStatus | null;
  drain: PermissionStatus | null;
}

export interface NodeDrainOperationPermissions {
  nodeMutation: PermissionStatus | null;
  podEvictionCreate: PermissionStatus | null;
  podDelete: PermissionStatus | null;
}

interface DrainStartPermissionInputs extends NodeDrainOperationPermissions {
  disableEviction: boolean;
}

const isAllowed = (status: PermissionStatus | null): boolean =>
  Boolean(status?.allowed && !status.pending);

const combineRequiredPermissions = (
  permissions: Array<PermissionStatus | null>
): PermissionStatus | null => {
  if (permissions.some((status) => status === null || status === undefined)) {
    return null;
  }
  if (permissions.some((status) => status?.pending)) {
    return { allowed: false, pending: true };
  }
  return {
    allowed: permissions.every((status) => status?.allowed),
    pending: false,
  };
};

const combineAlternativePermissions = (
  permissions: Array<PermissionStatus | null>
): PermissionStatus | null => {
  if (permissions.some(isAllowed)) {
    return { allowed: true, pending: false };
  }
  if (permissions.some((status) => status?.pending)) {
    return { allowed: false, pending: true };
  }
  if (permissions.every((status) => status === null || status === undefined)) {
    return null;
  }
  return { allowed: false, pending: false };
};

export const resolveNodeActionPermissionStatuses = ({
  nodeGet,
  nodePatch,
  podEvictionCreate,
  podDelete,
}: NodeActionPermissionInputs): NodeActionPermissionStatuses => {
  const nodeMutation = combineRequiredPermissions([nodeGet, nodePatch]);
  const podDrain = combineAlternativePermissions([podEvictionCreate, podDelete]);

  return {
    cordon: nodeMutation,
    drain: combineRequiredPermissions([nodeMutation, podDrain]),
  };
};

export const resolveNodeDrainOperationPermissions = (
  inputs: NodeActionPermissionInputs
): NodeDrainOperationPermissions => {
  const statuses = resolveNodeActionPermissionStatuses(inputs);
  return {
    nodeMutation: statuses.cordon,
    podEvictionCreate: inputs.podEvictionCreate,
    podDelete: inputs.podDelete,
  };
};

export const resolveDrainStartPermissionStatus = ({
  nodeMutation,
  podEvictionCreate,
  podDelete,
  disableEviction,
}: DrainStartPermissionInputs): PermissionStatus | null =>
  combineRequiredPermissions([nodeMutation, disableEviction ? podDelete : podEvictionCreate]);
