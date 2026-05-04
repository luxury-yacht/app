import { useCallback, useMemo, useState } from 'react';
import {
  DeletePod,
  DeleteResourceByGVK,
  RestartWorkload,
  ScaleWorkload,
  SuspendCronJob,
  TriggerCronJob,
} from '@wailsjs/go/backend/App';
import { getPermissionKey, queryKindPermissions, useUserPermissions } from '@/core/capabilities';
import { errorHandler } from '@/utils/errorHandler';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import RollbackModal from '@shared/components/modals/RollbackModal';
import ScaleModal from '@shared/components/modals/ScaleModal';
import { PortForwardModal, type PortForwardTarget } from '@modules/port-forward';
import { isObjectMapSupportedKind } from '@modules/object-panel/components/ObjectPanel/objectMapSupport';
import {
  buildObjectActionItems,
  normalizeKind,
  type ObjectActionData,
  type ObjectActionHandlers,
} from '@shared/hooks/useObjectActions';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { KubernetesObjectReference } from '@/types/view-state';

type ObjectActionContext = 'gridtable' | 'object-panel';
type ObjectActionReference = ObjectActionData & KubernetesObjectReference;

interface ObjectActionControllerOptions {
  context: ObjectActionContext;
  actionLoading?: boolean;
  queryMissingPermissions?: boolean;
  useDefaultHandlers?: boolean;
  onOpen?: (object: ObjectActionReference) => void;
  onOpenObjectMap?: (object: ObjectActionReference) => void;
  onViewInvolvedObject?: (object: ObjectActionReference) => void;
  handlerOverrides?: ObjectActionHandlers;
  onAfterAction?: (object: ObjectActionData, action: string) => void;
  onAfterDelete?: (object: ObjectActionData) => void;
}

interface ScaleState {
  object: ObjectActionData | null;
  value: number;
  loading: boolean;
  error: string | null;
}

const clampReplicas = (value: number): number => Math.max(0, Math.min(9999, value));

const extractDesiredReplicas = (object: ObjectActionData): number => {
  const ready = object.ready?.trim();
  if (!ready) return 1;
  const segments = ready.split('/');
  const candidate = Number.parseInt(segments[segments.length - 1]?.trim() ?? '', 10);
  return Number.isFinite(candidate) ? clampReplicas(candidate) : 1;
};

const apiVersionFor = (object: ObjectActionData): string => {
  if (object.requiresExplicitVersion && !object.explicitVersionProvided) {
    throw new Error(
      `Cannot delete ${object.kind}/${object.name}: apiVersion missing on custom resource row`
    );
  }
  const version = object.version?.trim();
  if (!version) {
    throw new Error(`Cannot delete ${object.kind}/${object.name}: apiVersion is missing`);
  }
  const group = object.group?.trim();
  return group ? `${group}/${version}` : version;
};

const requireClusterId = (object: ObjectActionData, action: string): string => {
  const clusterId = object.clusterId?.trim();
  if (!clusterId) {
    throw new Error(`Cannot ${action} ${object.kind}/${object.name}: clusterId is missing`);
  }
  return clusterId;
};

const portForwardTargetFor = (object: ObjectActionData): PortForwardTarget => ({
  kind: object.kind,
  group: object.group ?? '',
  version: object.version ?? 'v1',
  name: object.name,
  namespace: object.namespace ?? '',
  clusterId: requireClusterId(object, 'open port-forward for'),
  clusterName: object.clusterName ?? '',
  ports: [],
});

export const useObjectActionController = ({
  context,
  actionLoading = false,
  queryMissingPermissions = false,
  useDefaultHandlers = true,
  onOpen,
  onOpenObjectMap,
  onViewInvolvedObject,
  handlerOverrides,
  onAfterAction,
  onAfterDelete,
}: ObjectActionControllerOptions) => {
  const permissionMap = useUserPermissions();
  const [restartTarget, setRestartTarget] = useState<ObjectActionData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ObjectActionData | null>(null);
  const [triggerTarget, setTriggerTarget] = useState<ObjectActionData | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ObjectActionData | null>(null);
  const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);
  const [scaleState, setScaleState] = useState<ScaleState>({
    object: null,
    value: 1,
    loading: false,
    error: null,
  });

  const closeScale = useCallback(() => {
    if (scaleState.loading) return;
    setScaleState({ object: null, value: 1, loading: false, error: null });
  }, [scaleState.loading]);

  const getMenuItems = useCallback(
    (object: ObjectActionData | null): ContextMenuItem[] => {
      if (!object) return [];
      const actionObject = object as ObjectActionReference;
      const namespace = object.namespace ?? null;
      const clusterId = object.clusterId ?? null;
      const group = object.group ?? null;
      const version = object.version ?? null;
      const normalizedKind = normalizeKind(object.kind);
      const restartStatus =
        permissionMap.get(
          getPermissionKey(normalizedKind, 'patch', namespace, null, clusterId, group, version)
        ) ?? null;
      const deleteStatus =
        permissionMap.get(
          getPermissionKey(object.kind, 'delete', namespace, null, clusterId, group, version)
        ) ?? null;
      const scaleStatus =
        permissionMap.get(
          getPermissionKey(normalizedKind, 'update', namespace, 'scale', clusterId, group, version)
        ) ?? null;
      const portForwardStatus =
        permissionMap.get(
          getPermissionKey('Pod', 'create', namespace, 'portforward', clusterId, '', 'v1')
        ) ?? null;

      if (queryMissingPermissions && !deleteStatus) {
        queryKindPermissions(object.kind, namespace, clusterId, group, version);
      }

      return buildObjectActionItems({
        object,
        context,
        handlers: {
          onOpen: onOpen ? () => onOpen(actionObject) : undefined,
          onObjectMap:
            onOpenObjectMap && isObjectMapSupportedKind(object.kind)
              ? () => onOpenObjectMap(actionObject)
              : undefined,
          onViewInvolvedObject: onViewInvolvedObject
            ? () => onViewInvolvedObject(actionObject)
            : undefined,
          onRestart:
            handlerOverrides?.onRestart ??
            (useDefaultHandlers ? () => setRestartTarget(object) : undefined),
          onRollback:
            handlerOverrides?.onRollback ??
            (useDefaultHandlers ? () => setRollbackTarget(object) : undefined),
          onScale:
            handlerOverrides?.onScale ??
            (useDefaultHandlers
              ? () =>
                  setScaleState({
                    object,
                    value: extractDesiredReplicas(object),
                    loading: false,
                    error: null,
                  })
              : undefined),
          onDelete:
            handlerOverrides?.onDelete ??
            (useDefaultHandlers ? () => setDeleteTarget(object) : undefined),
          onPortForward:
            handlerOverrides?.onPortForward ??
            (useDefaultHandlers
              ? () => {
                  try {
                    setPortForwardTarget(portForwardTargetFor(object));
                  } catch (error) {
                    errorHandler.handle(error, {
                      action: 'portForward',
                      kind: object.kind,
                      name: object.name,
                    });
                  }
                }
              : undefined),
          onTrigger:
            handlerOverrides?.onTrigger ??
            (useDefaultHandlers ? () => setTriggerTarget(object) : undefined),
          onSuspendToggle:
            handlerOverrides?.onSuspendToggle ??
            (useDefaultHandlers
              ? async () => {
                  const isSuspended = object.status === 'Suspended';
                  try {
                    await SuspendCronJob(
                      requireClusterId(object, isSuspended ? 'resume' : 'suspend'),
                      object.namespace ?? '',
                      object.name,
                      !isSuspended
                    );
                    onAfterAction?.(object, isSuspended ? 'resume' : 'suspend');
                  } catch (error) {
                    errorHandler.handle(error, {
                      action: isSuspended ? 'resume' : 'suspend',
                      kind: object.kind,
                      name: object.name,
                    });
                  }
                }
              : undefined),
        },
        permissions: {
          restart: restartStatus,
          rollback: restartStatus,
          scale: scaleStatus,
          delete: deleteStatus,
          portForward: portForwardStatus,
        },
        actionLoading,
      });
    },
    [
      actionLoading,
      context,
      handlerOverrides,
      onAfterAction,
      onOpen,
      onOpenObjectMap,
      onViewInvolvedObject,
      permissionMap,
      queryMissingPermissions,
      useDefaultHandlers,
    ]
  );

  const confirmRestart = useCallback(async () => {
    const object = restartTarget;
    if (!object) return;
    try {
      await RestartWorkload(
        requireClusterId(object, 'restart'),
        object.namespace ?? '',
        object.name,
        object.kind
      );
      onAfterAction?.(object, 'restart');
    } catch (error) {
      errorHandler.handle(error, { action: 'restart', kind: object.kind, name: object.name });
    } finally {
      setRestartTarget(null);
    }
  }, [onAfterAction, restartTarget]);

  const confirmDelete = useCallback(async () => {
    const object = deleteTarget;
    if (!object) return;
    try {
      const clusterId = requireClusterId(object, 'delete');
      if (normalizeKind(object.kind) === 'Pod') {
        await DeletePod(clusterId, object.namespace ?? '', object.name);
      } else {
        await DeleteResourceByGVK(
          clusterId,
          apiVersionFor(object),
          object.kind,
          object.namespace ?? '',
          object.name
        );
      }
      onAfterDelete?.(object);
      onAfterAction?.(object, 'delete');
    } catch (error) {
      errorHandler.handle(error, { action: 'delete', kind: object.kind, name: object.name });
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, onAfterAction, onAfterDelete]);

  const confirmTrigger = useCallback(async () => {
    const object = triggerTarget;
    if (!object) return;
    try {
      await TriggerCronJob(
        requireClusterId(object, 'trigger'),
        object.namespace ?? '',
        object.name
      );
      onAfterAction?.(object, 'trigger');
    } catch (error) {
      errorHandler.handle(error, { action: 'trigger', kind: object.kind, name: object.name });
    } finally {
      setTriggerTarget(null);
    }
  }, [onAfterAction, triggerTarget]);

  const confirmScale = useCallback(async () => {
    const object = scaleState.object;
    if (!object) return;
    setScaleState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      await ScaleWorkload(
        requireClusterId(object, 'scale'),
        object.namespace ?? '',
        object.name,
        object.kind,
        scaleState.value
      );
      onAfterAction?.(object, 'scale');
      setScaleState({ object: null, value: 1, loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScaleState((previous) => ({ ...previous, loading: false, error: message }));
      errorHandler.handle(error, { action: 'scale', kind: object.kind, name: object.name });
    }
  }, [onAfterAction, scaleState.object, scaleState.value]);

  const confirmation = useMemo(() => {
    if (restartTarget) {
      return {
        title: `Restart ${restartTarget.kind || 'Workload'}`,
        message: `Are you sure you want to restart ${restartTarget.kind.toLowerCase()} "${restartTarget.name}"?\n\nThis will perform a rolling restart of all pods.`,
        confirmText: 'Restart',
        confirmButtonClass: 'danger',
        onConfirm: confirmRestart,
        onCancel: () => setRestartTarget(null),
      };
    }
    if (deleteTarget) {
      return {
        title: `Delete ${deleteTarget.kind || 'Resource'}`,
        message: `Are you sure you want to delete ${deleteTarget.kind.toLowerCase()} "${deleteTarget.name}"?\n\nThis action cannot be undone.`,
        confirmText: 'Delete',
        confirmButtonClass: 'danger',
        onConfirm: confirmDelete,
        onCancel: () => setDeleteTarget(null),
      };
    }
    if (triggerTarget) {
      return {
        title: 'Trigger CronJob',
        message: `Create a new Job from CronJob "${triggerTarget.name}" immediately?`,
        confirmText: 'Trigger',
        confirmButtonClass: undefined,
        onConfirm: confirmTrigger,
        onCancel: () => setTriggerTarget(null),
      };
    }
    return null;
  }, [confirmDelete, confirmRestart, confirmTrigger, deleteTarget, restartTarget, triggerTarget]);

  const modals = useMemo(
    () => (
      <>
        <ConfirmationModal
          isOpen={Boolean(confirmation)}
          title={confirmation?.title ?? ''}
          message={confirmation?.message ?? ''}
          confirmText={confirmation?.confirmText ?? 'Confirm'}
          cancelText="Cancel"
          confirmButtonClass={confirmation?.confirmButtonClass}
          onConfirm={confirmation?.onConfirm ?? (() => {})}
          onCancel={confirmation?.onCancel ?? (() => {})}
        />
        <ScaleModal
          isOpen={Boolean(scaleState.object)}
          kind={scaleState.object?.kind ?? ''}
          name={scaleState.object?.name}
          namespace={scaleState.object?.namespace}
          value={scaleState.value}
          loading={scaleState.loading}
          error={scaleState.error}
          onCancel={closeScale}
          onApply={confirmScale}
          onValueChange={(value) =>
            setScaleState((previous) => ({ ...previous, value: clampReplicas(value) }))
          }
        />
        <PortForwardModal target={portForwardTarget} onClose={() => setPortForwardTarget(null)} />
        {rollbackTarget?.clusterId && rollbackTarget.namespace && (
          <RollbackModal
            isOpen={true}
            onClose={() => setRollbackTarget(null)}
            clusterId={rollbackTarget.clusterId}
            namespace={rollbackTarget.namespace}
            name={rollbackTarget.name}
            kind={rollbackTarget.kind}
          />
        )}
      </>
    ),
    [
      closeScale,
      confirmation,
      confirmScale,
      portForwardTarget,
      rollbackTarget,
      scaleState.error,
      scaleState.loading,
      scaleState.object,
      scaleState.value,
    ]
  );

  return { getMenuItems, modals };
};
