/**
 * frontend/src/shared/hooks/useObjectActionController.tsx
 *
 * Coordinates shared Kubernetes object actions for table rows and object-panel
 * headers, including permission-aware menus, modals, object-map navigation,
 * port-forward setup, and destructive action confirmation.
 */

import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { isObjectMapSupportedKind } from '@modules/object-panel/objectPanelRef';
import { PortForwardModal, type PortForwardTarget } from '@modules/port-forward';
import {
  buildObjectActionTarget,
  runCronJobSuspend,
  runCronJobTrigger,
  runObjectDelete,
  runObjectRestart,
  runObjectScale,
} from '@shared/actions/objectActionClient';
import {
  buildNodeActionPermissionDescriptorMap,
  buildObjectActionPermissionDescriptor,
  OBJECT_ACTION_IDS,
  type ObjectActionPermissionDescriptor,
} from '@shared/actions/objectActionContract';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import RollbackModal from '@shared/components/modals/RollbackModal';
import ScaleModal from '@shared/components/modals/ScaleModal';
import { resolveNodeActionPermissionStatuses } from '@shared/hooks/nodeActionPermissions';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import {
  buildObjectActionItems,
  normalizeKind,
  type ObjectActionData,
  type ObjectActionHandlers,
} from '@shared/hooks/useObjectActions';
import { useCallback, useMemo, useState } from 'react';
import { getPermissionKey, queryKindPermissions, useUserPermissions } from '@/core/capabilities';
import type { KubernetesObjectReference } from '@/types/view-state';
import { errorHandler } from '@/utils/errorHandler';

type ObjectActionContext = 'gridtable' | 'object-map' | 'object-panel';
type ObjectActionReference = ObjectActionData & KubernetesObjectReference;

interface PerObjectHandlers {
  onCordon?: (object: ObjectActionData) => void;
  onDrain?: (object: ObjectActionData) => void;
}

interface ObjectActionControllerOptions {
  context: ObjectActionContext;
  actionLoading?: boolean;
  queryMissingPermissions?: boolean;
  useDefaultHandlers?: boolean;
  onOpen?: (object: ObjectActionReference) => void;
  onOpenObjectMap?: (object: ObjectActionReference) => void;
  onNavigateView?: (object: ObjectActionReference) => void;
  onViewInvolvedObject?: (object: ObjectActionReference) => void;
  handlerOverrides?: ObjectActionHandlers;
  /**
   * Per-row handlers that receive the resolved object when the menu item
   * is clicked. Use this for kind-specific actions (cordon/drain) where
   * each row needs to dispatch with its own context.
   */
  perObjectHandlers?: PerObjectHandlers;
  onAfterAction?: (object: ObjectActionData, action: string) => void;
  onAfterDelete?: (object: ObjectActionData) => void;
}

interface ScaleState {
  object: ObjectActionData | null;
  value: number;
  loading: boolean;
  error: string | null;
}

interface ScaleConfirmationState {
  object: ObjectActionData;
  replicas: number;
}

const clampReplicas = (value: number): number => Math.max(0, Math.min(9999, value));

const extractDesiredReplicas = (object: ObjectActionData): number => {
  if (typeof object.desiredReplicas === 'number' && Number.isFinite(object.desiredReplicas)) {
    return clampReplicas(object.desiredReplicas);
  }
  const ready = object.ready?.trim();
  if (!ready) {
    return 0;
  }
  const segments = ready.split('/');
  const candidate = Number.parseInt(segments[segments.length - 1]?.trim() ?? '', 10);
  return Number.isFinite(candidate) ? clampReplicas(candidate) : 0;
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

const actionTargetFor = (object: ObjectActionData, action: string) => {
  if (object.requiresExplicitVersion && !object.explicitVersionProvided) {
    throw new Error(
      `Cannot ${action} ${object.kind}/${object.name}: version missing on custom resource row`
    );
  }
  return buildObjectActionTarget(object, action);
};

const permissionKeyInput = (descriptor: ObjectActionPermissionDescriptor) => ({
  resourceKind: descriptor.resourceKind,
  verb: descriptor.verb,
  namespace: descriptor.namespace ?? null,
  subresource: descriptor.subresource ?? null,
  clusterId: descriptor.clusterId ?? null,
  group: descriptor.group ?? null,
  version: descriptor.version ?? null,
});

export const useObjectActionController = ({
  context,
  actionLoading = false,
  queryMissingPermissions = false,
  useDefaultHandlers = true,
  onOpen,
  onOpenObjectMap,
  onNavigateView,
  onViewInvolvedObject,
  handlerOverrides,
  perObjectHandlers,
  onAfterAction,
  onAfterDelete,
}: ObjectActionControllerOptions) => {
  const permissionMap = useUserPermissions();
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const [restartTarget, setRestartTarget] = useState<ObjectActionData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ObjectActionData | null>(null);
  const [triggerTarget, setTriggerTarget] = useState<ObjectActionData | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ObjectActionData | null>(null);
  const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);
  const [scaleConfirmation, setScaleConfirmation] = useState<ScaleConfirmationState | null>(null);
  const [scaleState, setScaleState] = useState<ScaleState>({
    object: null,
    value: 1,
    loading: false,
    error: null,
  });

  const closeScale = useCallback(() => {
    if (scaleState.loading) {
      return;
    }
    setScaleState({ object: null, value: 1, loading: false, error: null });
  }, [scaleState.loading]);

  const getMenuItems = useCallback(
    (object: ObjectActionData | null): ContextMenuItem[] => {
      if (!object) {
        return [];
      }
      const actionObject = object as ObjectActionReference;
      const namespace = object.namespace ?? null;
      const clusterId = object.clusterId ?? null;
      const group = object.group ?? null;
      const version = object.version ?? null;
      const normalizedKind = normalizeKind(object.kind);
      const actionPermissionSource = {
        clusterId,
        group,
        version,
        kind: normalizedKind,
        namespace,
        name: object.name,
      };
      const targetPermissionSource = {
        ...actionPermissionSource,
        kind: object.kind,
      };
      const permissionStatusFor = (descriptor: ObjectActionPermissionDescriptor | null) => {
        if (!descriptor) {
          return null;
        }
        const input = permissionKeyInput(descriptor);
        return (
          permissionMap.get(
            getPermissionKey(
              input.resourceKind,
              input.verb,
              input.namespace,
              input.subresource,
              input.clusterId,
              input.group,
              input.version
            )
          ) ?? null
        );
      };
      const restartStatus = permissionStatusFor(
        buildObjectActionPermissionDescriptor(OBJECT_ACTION_IDS.restart, actionPermissionSource)
      );
      const rollbackStatus = permissionStatusFor(
        buildObjectActionPermissionDescriptor(OBJECT_ACTION_IDS.rollback, actionPermissionSource)
      );
      const deleteStatus = permissionStatusFor(
        buildObjectActionPermissionDescriptor(OBJECT_ACTION_IDS.delete, targetPermissionSource)
      );
      const scaleStatus = permissionStatusFor(
        buildObjectActionPermissionDescriptor(OBJECT_ACTION_IDS.scale, actionPermissionSource)
      );
      const triggerStatus =
        normalizedKind === 'CronJob'
          ? permissionStatusFor(
              buildObjectActionPermissionDescriptor(
                OBJECT_ACTION_IDS.triggerNow,
                actionPermissionSource
              )
            )
          : null;
      const suspendStatus =
        normalizedKind === 'CronJob'
          ? permissionStatusFor(
              buildObjectActionPermissionDescriptor(
                OBJECT_ACTION_IDS.suspend,
                actionPermissionSource
              )
            )
          : null;
      const portForwardStatus = permissionStatusFor(
        buildObjectActionPermissionDescriptor(OBJECT_ACTION_IDS.portForward, actionPermissionSource)
      );
      const nodeDescriptors = buildNodeActionPermissionDescriptorMap(actionPermissionSource);
      const nodeActionPermissions =
        normalizedKind === 'Node'
          ? resolveNodeActionPermissionStatuses({
              nodeGet: permissionStatusFor(nodeDescriptors.nodeGet),
              nodePatch: permissionStatusFor(nodeDescriptors.nodePatch),
              podEvictionCreate: permissionStatusFor(nodeDescriptors.podEvictionCreate),
              podDelete: permissionStatusFor(nodeDescriptors.podDelete),
            })
          : { cordon: null, drain: null };

      if (queryMissingPermissions && !deleteStatus) {
        queryKindPermissions(object.kind, namespace, clusterId, group, version);
      }

      return buildObjectActionItems({
        object,
        context,
        handlers: {
          onOpen: onOpen ? () => onOpen(actionObject) : undefined,
          onNavigateView: () => {
            if (onNavigateView) {
              onNavigateView(actionObject);
              return;
            }
            navigateToView(actionObject);
          },
          onObjectMap: isObjectMapSupportedKind(object.kind)
            ? () => {
                if (onOpenObjectMap) {
                  onOpenObjectMap(actionObject);
                  return;
                }
                openWithObject(actionObject, { initialTab: 'map' });
              }
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
          onScaleToZero:
            handlerOverrides?.onScaleToZero ??
            (useDefaultHandlers ? () => setScaleConfirmation({ object, replicas: 0 }) : undefined),
          onResumeFromZero:
            handlerOverrides?.onResumeFromZero ??
            (useDefaultHandlers
              ? async () => {
                  try {
                    await runObjectScale(actionTargetFor(object, 'scale'), 1);
                    onAfterAction?.(object, 'scale');
                  } catch (error) {
                    errorHandler.handle(error, {
                      action: 'scale',
                      kind: object.kind,
                      name: object.name,
                    });
                  }
                }
              : undefined),
          onDelete:
            handlerOverrides?.onDelete ??
            (useDefaultHandlers ? () => setDeleteTarget(object) : undefined),
          onCordon:
            handlerOverrides?.onCordon ??
            (perObjectHandlers?.onCordon ? () => perObjectHandlers.onCordon?.(object) : undefined),
          onDrain:
            handlerOverrides?.onDrain ??
            (perObjectHandlers?.onDrain ? () => perObjectHandlers.onDrain?.(object) : undefined),
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
                    await runCronJobSuspend(
                      actionTargetFor(object, isSuspended ? 'resume' : 'suspend'),
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
          rollback: rollbackStatus,
          scale: scaleStatus,
          trigger: triggerStatus,
          suspend: suspendStatus,
          delete: deleteStatus,
          portForward: portForwardStatus,
          cordon: nodeActionPermissions.cordon,
          drain: nodeActionPermissions.drain,
        },
        actionLoading,
      });
    },
    [
      actionLoading,
      context,
      handlerOverrides,
      perObjectHandlers,
      onAfterAction,
      onOpen,
      onOpenObjectMap,
      onNavigateView,
      onViewInvolvedObject,
      openWithObject,
      permissionMap,
      queryMissingPermissions,
      navigateToView,
      useDefaultHandlers,
    ]
  );

  const confirmRestart = useCallback(async () => {
    const object = restartTarget;
    if (!object) {
      return;
    }
    try {
      await runObjectRestart(actionTargetFor(object, 'restart'));
      onAfterAction?.(object, 'restart');
    } catch (error) {
      errorHandler.handle(error, { action: 'restart', kind: object.kind, name: object.name });
    } finally {
      setRestartTarget(null);
    }
  }, [onAfterAction, restartTarget]);

  const confirmDelete = useCallback(async () => {
    const object = deleteTarget;
    if (!object) {
      return;
    }
    try {
      await runObjectDelete(actionTargetFor(object, 'delete'));
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
    if (!object) {
      return;
    }
    try {
      await runCronJobTrigger(actionTargetFor(object, 'trigger'));
      onAfterAction?.(object, 'trigger');
    } catch (error) {
      errorHandler.handle(error, { action: 'trigger', kind: object.kind, name: object.name });
    } finally {
      setTriggerTarget(null);
    }
  }, [onAfterAction, triggerTarget]);

  const applyScaleValue = useCallback(
    async (replicas: number) => {
      const object = scaleState.object;
      if (!object) {
        return;
      }
      setScaleState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        await runObjectScale(actionTargetFor(object, 'scale'), replicas);
        onAfterAction?.(object, 'scale');
        setScaleState({ object: null, value: 1, loading: false, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setScaleState((previous) => ({ ...previous, loading: false, error: message }));
        errorHandler.handle(error, { action: 'scale', kind: object.kind, name: object.name });
      }
    },
    [onAfterAction, scaleState.object]
  );

  const confirmScale = useCallback(async () => {
    await applyScaleValue(scaleState.value);
  }, [applyScaleValue, scaleState.value]);

  const confirmScaleToZero = useCallback(async () => {
    const confirmation = scaleConfirmation;
    if (!confirmation) {
      return;
    }
    const { object, replicas } = confirmation;
    try {
      await runObjectScale(actionTargetFor(object, 'scale'), replicas);
      onAfterAction?.(object, 'scale');
    } catch (error) {
      errorHandler.handle(error, { action: 'scale', kind: object.kind, name: object.name });
    } finally {
      setScaleConfirmation(null);
    }
  }, [onAfterAction, scaleConfirmation]);

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
      const isUndrainedNode =
        normalizeKind(deleteTarget.kind) === 'Node' && !deleteTarget.unschedulable;
      return {
        title: `Delete ${deleteTarget.kind || 'Resource'}`,
        message: `Are you sure you want to delete ${deleteTarget.kind.toLowerCase()} "${deleteTarget.name}"?\n\nThis action cannot be undone.`,
        warning: isUndrainedNode
          ? 'This node has not been drained. Pods running on it will be terminated abruptly when the node is removed.'
          : undefined,
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
    if (scaleConfirmation) {
      const object = scaleConfirmation.object;
      return {
        title: 'Scale to 0',
        message: `Scale ${object.kind.toLowerCase()} "${object.name}" to 0 replicas?`,
        warning: 'This will stop currently running pods for this workload.',
        confirmText: 'Scale to 0',
        confirmButtonClass: 'danger',
        onConfirm: confirmScaleToZero,
        onCancel: () => setScaleConfirmation(null),
      };
    }
    return null;
  }, [
    confirmDelete,
    confirmRestart,
    confirmScaleToZero,
    confirmTrigger,
    deleteTarget,
    restartTarget,
    scaleConfirmation,
    triggerTarget,
  ]);

  const modals = useMemo(
    () => (
      <>
        <ConfirmationModal
          isOpen={Boolean(confirmation)}
          title={confirmation?.title ?? ''}
          message={confirmation?.message ?? ''}
          warning={confirmation?.warning}
          confirmText={confirmation?.confirmText ?? 'Confirm'}
          cancelText="Cancel"
          confirmButtonClass={confirmation?.confirmButtonClass}
          onConfirm={confirmation?.onConfirm ?? (() => undefined)}
          onCancel={confirmation?.onCancel ?? (() => undefined)}
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
          onScaleToZero={() => {
            if (!scaleState.object) {
              return;
            }
            setScaleConfirmation({ object: scaleState.object, replicas: 0 });
            setScaleState({ object: null, value: 1, loading: false, error: null });
          }}
          onValueChange={(value) =>
            setScaleState((previous) => ({ ...previous, value: clampReplicas(value) }))
          }
        />
        <PortForwardModal target={portForwardTarget} onClose={() => setPortForwardTarget(null)} />
        {!!(rollbackTarget?.clusterId && rollbackTarget.namespace && rollbackTarget.version) && (
          <RollbackModal
            isOpen={true}
            onClose={() => setRollbackTarget(null)}
            clusterId={rollbackTarget.clusterId}
            namespace={rollbackTarget.namespace}
            group={rollbackTarget.group ?? ''}
            version={rollbackTarget.version}
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
