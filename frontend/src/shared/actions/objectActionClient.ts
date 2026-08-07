/**
 * frontend/src/shared/actions/objectActionClient.ts
 *
 * Wraps backend RunObjectAction calls with full object identity payloads.
 */

import type { ResourceRef } from '@core/refresh/types';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { RunObjectAction } from '@/core/backend-api';
import { runUserAction } from '@/core/telemetry/sentry';
import type { ObjectActionName } from './objectActionContract';
import { OBJECT_ACTIONS } from './objectActionContract';

export type { ObjectActionName } from './objectActionContract';

export type ObjectActionTargetRef = Omit<ResourceRef, 'name'> & { name: string };

export interface ObjectActionIdentitySource {
  clusterId?: string | null;
  group?: string | null;
  version?: string | null;
  kind?: string | null;
  namespace?: string | null;
  name?: string | null;
}

export interface ObjectActionRequest {
  action: ObjectActionName;
  target: ObjectActionTargetRef;
  replicas?: number;
  suspend?: boolean;
  drainOptions?: unknown;
  portForward?: {
    containerPort: number;
    localPort: number;
  };
  debugContainer?: {
    image: string;
    targetContainer?: string;
  };
  revision?: number;
}

export interface ObjectActionResponse {
  name?: string;
  jobId?: string;
  sessionId?: string;
  debugContainer?: unknown;
}

const normalizeRequired = (
  value: string | null | undefined,
  field: string,
  action: string
): string => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new Error(`Cannot ${action}: ${field} is missing`);
  }
  return trimmed;
};

interface ActionGVK {
  group: string;
  version: string;
  kind: string;
}

interface SuppliedActionGVK {
  groupWasCarried: boolean;
  group: string | undefined;
  version: string;
}

const readSuppliedActionGVK = (source: ObjectActionIdentitySource): SuppliedActionGVK => {
  const groupWasCarried = source.group !== undefined && source.group !== null;
  return {
    groupWasCarried,
    group: groupWasCarried ? (source.group ?? '').trim() : undefined,
    version: source.version?.trim() ?? '',
  };
};

const resolveHelmReleaseActionGVK = (
  kind: string,
  supplied: SuppliedActionGVK
): ActionGVK | null => {
  if (kind.toLowerCase() !== 'helmrelease') {
    return null;
  }
  if (!supplied.version || supplied.group === 'helm.sh') {
    return { group: 'helm.sh', version: 'v3', kind: 'HelmRelease' };
  }
  return null;
};

const resolveBuiltinActionGVK = (kind: string): ActionGVK | null => {
  const builtin = resolveBuiltinGroupVersion(kind);
  if (builtin.group === undefined || builtin.version === undefined) {
    return null;
  }
  return { group: builtin.group, version: builtin.version, kind };
};

const resolveVersionedActionGVK = (
  supplied: SuppliedActionGVK,
  builtin: ActionGVK | null,
  kind: string,
  action: string
): ActionGVK => {
  if (builtin) {
    const group = supplied.groupWasCarried ? (supplied.group ?? '') : builtin.group;
    if (group !== builtin.group || supplied.version !== builtin.version) {
      throw new Error(`Cannot ${action} ${kind}: unsupported group/version`);
    }
    return builtin;
  }
  if (!supplied.groupWasCarried || !supplied.group) {
    throw new Error(`Cannot ${action} ${kind}: group is missing`);
  }
  return { group: supplied.group, version: supplied.version, kind };
};

const resolveActionGVK = (source: ObjectActionIdentitySource, action: string): ActionGVK => {
  const kind = normalizeRequired(source.kind, 'kind', action);
  const supplied = readSuppliedActionGVK(source);
  const helmRelease = resolveHelmReleaseActionGVK(kind, supplied);
  if (helmRelease) {
    return helmRelease;
  }

  const builtin = resolveBuiltinActionGVK(kind);
  if (supplied.version) {
    return resolveVersionedActionGVK(supplied, builtin, kind, action);
  }
  if (builtin) {
    return builtin;
  }
  throw new Error(`Cannot ${action} ${kind}: version is missing`);
};

export const buildObjectActionTarget = (
  source: ObjectActionIdentitySource,
  action: string
): ObjectActionTargetRef => {
  const clusterId = normalizeRequired(source.clusterId, 'clusterId', action);
  const name = normalizeRequired(source.name, 'name', action);
  const { group, version, kind } = resolveActionGVK(source, action);
  return {
    clusterId,
    group,
    version,
    kind,
    namespace: source.namespace?.trim() ?? '',
    name,
  };
};

const runObjectAction = async (request: ObjectActionRequest): Promise<ObjectActionResponse> => {
  return runUserAction(
    request.action,
    async () => (await RunObjectAction(request as never)) as ObjectActionResponse
  );
};

export const runObjectDelete = (target: ObjectActionTargetRef): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.delete, target });

export const runObjectRestart = (target: ObjectActionTargetRef): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.restart, target });

export const runObjectScale = (
  target: ObjectActionTargetRef,
  replicas: number
): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.scale, target, replicas });

export const runCronJobTrigger = (target: ObjectActionTargetRef): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.trigger, target });

export const runCronJobSuspend = (
  target: ObjectActionTargetRef,
  suspend: boolean
): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.suspend, target, suspend });

export const runNodeCordon = (target: ObjectActionTargetRef): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.cordon, target });

export const runNodeUncordon = (target: ObjectActionTargetRef): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.uncordon, target });

export const runStartDrain = (
  target: ObjectActionTargetRef,
  drainOptions: unknown
): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.startDrain, target, drainOptions });

export const runStartPortForward = (
  target: ObjectActionTargetRef,
  portForward: { containerPort: number; localPort: number }
): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.startPortForward, target, portForward });

export const runCreateDebugContainer = (
  target: ObjectActionTargetRef,
  debugContainer: { image: string; targetContainer?: string }
): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.createDebugContainer, target, debugContainer });

export const runObjectRollback = (
  target: ObjectActionTargetRef,
  revision: number
): Promise<ObjectActionResponse> =>
  runObjectAction({ action: OBJECT_ACTIONS.rollback, target, revision });
