import { RunObjectAction } from '@wailsjs/go/backend/App';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';

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

export interface ObjectActionTargetRef {
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  namespace?: string;
  name: string;
}

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

const resolveActionGVK = (
  source: ObjectActionIdentitySource,
  action: string
): { group: string; version: string; kind: string } => {
  const kind = normalizeRequired(source.kind, 'kind', action);
  const suppliedVersion = source.version?.trim() ?? '';
  if (
    kind.toLowerCase() === 'helmrelease' &&
    (!suppliedVersion || (source.group?.trim() ?? '') === 'helm.sh')
  ) {
    return { group: 'helm.sh', version: 'v3', kind: 'HelmRelease' };
  }

  const groupWasCarried = source.group !== undefined && source.group !== null;
  const suppliedGroup = groupWasCarried ? (source.group ?? '').trim() : undefined;
  const builtin = resolveBuiltinGroupVersion(kind);
  const builtinGVK =
    builtin.group !== undefined && builtin.version !== undefined
      ? { group: builtin.group, version: builtin.version, kind }
      : null;

  if (suppliedVersion) {
    if (builtinGVK) {
      const group = groupWasCarried ? suppliedGroup! : builtinGVK.group;
      if (group !== builtinGVK.group || suppliedVersion !== builtinGVK.version) {
        throw new Error(`Cannot ${action} ${kind}: unsupported apiVersion`);
      }
      return builtinGVK;
    }
    if (!groupWasCarried || !suppliedGroup) {
      throw new Error(`Cannot ${action} ${kind}: apiGroup is missing`);
    }
    return { group: suppliedGroup, version: suppliedVersion, kind };
  }

  if (builtinGVK) {
    return builtinGVK;
  }
  throw new Error(`Cannot ${action} ${kind}: apiVersion is missing`);
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
  return (await RunObjectAction(request as never)) as ObjectActionResponse;
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
