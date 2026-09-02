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
  type FinalizerPath,
  runCronJobSuspend,
  runCronJobTrigger,
  runObjectDelete,
  runObjectFinalizerRemoval,
  runObjectRestart,
  runObjectScale,
} from '@shared/actions/objectActionClient';
import {
  buildNodeActionPermissionDescriptorMap,
  buildObjectActionPermissionDescriptor,
  OBJECT_ACTION_IDS,
  type ObjectActionIdentitySource,
  type ObjectActionPermissionDescriptor,
} from '@shared/actions/objectActionContract';
import type {
  ObjectActionPermissionStatuses,
  PermissionStatus,
} from '@shared/actions/objectActionPolicy';
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
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  getPermissionKey,
  type PermissionMap,
  queryKindPermissions,
  useUserPermissions,
} from '@/core/capabilities';
import { usePanelWindowRole } from '@/core/panel-windows/PanelWindowRoleContext';
import { usePanelLifecycleGuard } from '@/core/panel-windows/panelLifecycleGuards';
import type { KubernetesObjectReference } from '@/types/view-state';
import { errorHandler } from '@/utils/errorHandler';

type ObjectActionContext = 'gridtable' | 'object-map' | 'object-panel';
type ObjectActionReference = ObjectActionData & KubernetesObjectReference;

export const resolveObjectActionGuardPanelId = (panelId: string | null): string | null => panelId;

export const resolveNavigateViewHandler = (
  explicitHandler: (() => void) | undefined,
  fallbackHandler: () => void,
  fallbackAvailable: boolean
): (() => void) | undefined => explicitHandler ?? (fallbackAvailable ? fallbackHandler : undefined);

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

interface FinalizerRemovalTarget {
  object: ObjectActionData;
  finalizer: string;
  path: FinalizerPath;
  deletionTimestamp?: string;
}

const FINALIZER_CLEANUP_GRACE_MS = 5 * 60 * 1000;
const RECENT_FINALIZER_REMOVAL_NOTICE =
  'Less than 5 minutes has elapsed since the delete was requested. Are you sure you want to delete the finalizer now, without giving the controller more time to clean up?';

const deletionIsWithinFinalizerCleanupGrace = (deletionTimestamp?: string): boolean => {
  if (!deletionTimestamp) {
    return false;
  }
  const requestedAt = Date.parse(deletionTimestamp);
  return Number.isFinite(requestedAt) && Date.now() < requestedAt + FINALIZER_CLEANUP_GRACE_MS;
};

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

const portForwardTargetFor = (object: ObjectActionData): PortForwardTarget => ({
  kind: object.kind,
  group: object.group,
  version: object.version,
  name: object.name,
  namespace: object.namespace ?? '',
  clusterId: object.clusterId,
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

const permissionStatusFor = (
  permissionMap: PermissionMap,
  descriptor: ObjectActionPermissionDescriptor | null
): PermissionStatus | null => {
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

const resolveNodePermissions = (
  permissionMap: PermissionMap,
  source: ObjectActionIdentitySource,
  normalizedKind: string
): Pick<ObjectActionPermissionStatuses, 'cordon' | 'drain'> => {
  if (normalizedKind !== 'Node') {
    return { cordon: null, drain: null };
  }
  const descriptors = buildNodeActionPermissionDescriptorMap(source);
  return resolveNodeActionPermissionStatuses({
    nodeGet: permissionStatusFor(permissionMap, descriptors.nodeGet),
    nodePatch: permissionStatusFor(permissionMap, descriptors.nodePatch),
    podEvictionCreate: permissionStatusFor(permissionMap, descriptors.podEvictionCreate),
    podDelete: permissionStatusFor(permissionMap, descriptors.podDelete),
  });
};

const actionPermissionStatus = (
  permissionMap: PermissionMap,
  actionId: Parameters<typeof buildObjectActionPermissionDescriptor>[0],
  source: ObjectActionIdentitySource
): PermissionStatus | null =>
  permissionStatusFor(permissionMap, buildObjectActionPermissionDescriptor(actionId, source));

const resolveObjectActionPermissions = (
  object: ObjectActionData,
  permissionMap: PermissionMap
): ObjectActionPermissionStatuses => {
  const normalizedKind = normalizeKind(object.kind);
  const source: ObjectActionIdentitySource = {
    clusterId: object.clusterId,
    group: object.group,
    version: object.version,
    kind: normalizedKind,
    namespace: object.namespace ?? null,
    name: object.name,
  };
  const targetSource: ObjectActionIdentitySource = { ...source, kind: object.kind };
  const isCronJob = normalizedKind === 'CronJob';
  const nodePermissions = resolveNodePermissions(permissionMap, source, normalizedKind);

  return {
    restart: actionPermissionStatus(permissionMap, OBJECT_ACTION_IDS.restart, source),
    rollback: actionPermissionStatus(permissionMap, OBJECT_ACTION_IDS.rollback, source),
    delete: actionPermissionStatus(permissionMap, OBJECT_ACTION_IDS.delete, targetSource),
    scale: actionPermissionStatus(permissionMap, OBJECT_ACTION_IDS.scale, source),
    trigger: isCronJob
      ? actionPermissionStatus(permissionMap, OBJECT_ACTION_IDS.triggerNow, source)
      : null,
    suspend: isCronJob
      ? actionPermissionStatus(permissionMap, OBJECT_ACTION_IDS.suspend, source)
      : null,
    portForward: actionPermissionStatus(permissionMap, OBJECT_ACTION_IDS.portForward, source),
    ...nodePermissions,
  };
};

interface NavigationHandlerOptions {
  object: ObjectActionData;
  onOpen: ObjectActionControllerOptions['onOpen'];
  onOpenObjectMap: ObjectActionControllerOptions['onOpenObjectMap'];
  onNavigateView: ObjectActionControllerOptions['onNavigateView'];
  onViewInvolvedObject: ObjectActionControllerOptions['onViewInvolvedObject'];
  openWithObject: ReturnType<typeof useObjectPanel>['openWithObject'];
  navigateToView: ReturnType<typeof useNavigateToView>['navigateToView'];
  navigateToViewAvailable: boolean;
}

const buildNavigationHandlers = ({
  object,
  onOpen,
  onOpenObjectMap,
  onNavigateView,
  onViewInvolvedObject,
  openWithObject,
  navigateToView,
  navigateToViewAvailable,
}: NavigationHandlerOptions): ObjectActionHandlers => {
  const actionObject = object as ObjectActionReference;
  return {
    onOpen: onOpen ? () => onOpen(actionObject) : undefined,
    onNavigateView: resolveNavigateViewHandler(
      onNavigateView ? () => onNavigateView(actionObject) : undefined,
      () => navigateToView(actionObject),
      navigateToViewAvailable
    ),
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
  };
};

interface ActionExecutionOptions {
  object: ObjectActionData;
  action: string;
  execute: () => Promise<unknown>;
  onAfterAction: ObjectActionControllerOptions['onAfterAction'];
}

const executeObjectAction = async ({
  object,
  action,
  execute,
  onAfterAction,
}: ActionExecutionOptions): Promise<void> => {
  try {
    await execute();
    onAfterAction?.(object, action);
  } catch (error) {
    errorHandler.handle(error, { action, kind: object.kind, name: object.name });
  }
};

interface DefaultHandlerSetters {
  setRestartTarget: (object: ObjectActionData) => void;
  setRollbackTarget: (object: ObjectActionData) => void;
  setScaleTarget: (state: ScaleState) => void;
  setScaleConfirmation: (state: ScaleConfirmationState) => void;
  setDeleteTarget: (object: ObjectActionData) => void;
  setPortForwardTarget: (target: PortForwardTarget) => void;
  setTriggerTarget: (object: ObjectActionData) => void;
  executeMutation: (execute: () => Promise<unknown>) => Promise<unknown>;
}

const buildDefaultActionHandlers = (
  object: ObjectActionData,
  enabled: boolean,
  setters: DefaultHandlerSetters,
  onAfterAction?: ObjectActionControllerOptions['onAfterAction']
): ObjectActionHandlers => {
  if (!enabled) {
    return {};
  }
  return {
    onRestart: () => setters.setRestartTarget(object),
    onRollback: () => setters.setRollbackTarget(object),
    onScale: () =>
      setters.setScaleTarget({
        object,
        value: extractDesiredReplicas(object),
        loading: false,
        error: null,
      }),
    onScaleToZero: () => setters.setScaleConfirmation({ object, replicas: 0 }),
    onResumeFromZero: () =>
      setters.executeMutation(() =>
        executeObjectAction({
          object,
          action: 'scale',
          execute: () => runObjectScale(actionTargetFor(object, 'scale'), 1),
          onAfterAction,
        })
      ),
    onDelete: () => setters.setDeleteTarget(object),
    onPortForward: () => {
      try {
        setters.setPortForwardTarget(portForwardTargetFor(object));
      } catch (error) {
        errorHandler.handle(error, {
          action: 'portForward',
          kind: object.kind,
          name: object.name,
        });
      }
    },
    onTrigger: () => setters.setTriggerTarget(object),
    onSuspendToggle: () => {
      const isSuspended = object.status === 'Suspended';
      const action = isSuspended ? 'resume' : 'suspend';
      return setters.executeMutation(() =>
        executeObjectAction({
          object,
          action,
          execute: () => runCronJobSuspend(actionTargetFor(object, action), !isSuspended),
          onAfterAction,
        })
      );
    },
  };
};

const buildPerObjectHandlers = (
  object: ObjectActionData,
  handlers?: PerObjectHandlers
): Pick<ObjectActionHandlers, 'onCordon' | 'onDrain'> => ({
  onCordon: handlers?.onCordon ? () => handlers.onCordon?.(object) : undefined,
  onDrain: handlers?.onDrain ? () => handlers.onDrain?.(object) : undefined,
});

interface ControllerHandlerOptions extends NavigationHandlerOptions {
  useDefaultHandlers: boolean;
  handlerOverrides?: ObjectActionHandlers;
  perObjectHandlers?: PerObjectHandlers;
  setters: DefaultHandlerSetters;
  onAfterAction: ObjectActionControllerOptions['onAfterAction'];
}

const buildControllerHandlers = (options: ControllerHandlerOptions): ObjectActionHandlers => {
  const navigation = buildNavigationHandlers(options);
  const defaults = buildDefaultActionHandlers(
    options.object,
    options.useDefaultHandlers,
    options.setters,
    options.onAfterAction
  );
  const perObject = buildPerObjectHandlers(options.object, options.perObjectHandlers);
  const overrides = options.handlerOverrides;

  return {
    ...navigation,
    onRestart: overrides?.onRestart ?? defaults.onRestart,
    onRollback: overrides?.onRollback ?? defaults.onRollback,
    onScale: overrides?.onScale ?? defaults.onScale,
    onScaleToZero: overrides?.onScaleToZero ?? defaults.onScaleToZero,
    onResumeFromZero: overrides?.onResumeFromZero ?? defaults.onResumeFromZero,
    onDelete: overrides?.onDelete ?? defaults.onDelete,
    onCordon: overrides?.onCordon ?? perObject.onCordon,
    onDrain: overrides?.onDrain ?? perObject.onDrain,
    onPortForward: overrides?.onPortForward ?? defaults.onPortForward,
    onTrigger: overrides?.onTrigger ?? defaults.onTrigger,
    onSuspendToggle: overrides?.onSuspendToggle ?? defaults.onSuspendToggle,
  };
};

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
  const { openWithObject, panelId } = useObjectPanel();
  const panelWindowRole = usePanelWindowRole();
  const { available: navigateToViewAvailable, navigateToView } = useNavigateToView();
  const navigateFallbackAvailable = panelWindowRole === null || navigateToViewAvailable;
  const [restartTarget, setRestartTarget] = useState<ObjectActionData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ObjectActionData | null>(null);
  const [triggerTarget, setTriggerTarget] = useState<ObjectActionData | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ObjectActionData | null>(null);
  const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);
  const [finalizerRemovalTarget, setFinalizerRemovalTarget] =
    useState<FinalizerRemovalTarget | null>(null);
  const [scaleConfirmation, setScaleConfirmation] = useState<ScaleConfirmationState | null>(null);
  const [scaleState, setScaleState] = useState<ScaleState>({
    object: null,
    value: 1,
    loading: false,
    error: null,
  });
  const mutationCountRef = useRef(0);
  const [, setMutationRevision] = useState(0);
  const executeMutation = useCallback(async <T,>(execute: () => Promise<T>): Promise<T> => {
    mutationCountRef.current += 1;
    setMutationRevision((revision) => revision + 1);
    try {
      return await execute();
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setMutationRevision((revision) => revision + 1);
    }
  }, []);
  const setNestedMutationInFlight = useCallback((inFlight: boolean) => {
    mutationCountRef.current = Math.max(0, mutationCountRef.current + (inFlight ? 1 : -1));
    setMutationRevision((revision) => revision + 1);
  }, []);
  usePanelLifecycleGuard(resolveObjectActionGuardPanelId(panelId), () => {
    if (!actionLoading && mutationCountRef.current === 0) {
      return null;
    }
    return {
      reason: 'mutation-in-flight',
      focus: () => {
        if (!panelId || typeof document === 'undefined') {
          return;
        }
        const panel = Array.from(document.querySelectorAll<HTMLElement>('[data-panel-id]')).find(
          (element) => element.dataset.panelId === panelId
        );
        panel?.focus();
      },
    };
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
      const permissions = resolveObjectActionPermissions(object, permissionMap);
      if (queryMissingPermissions && !permissions.delete) {
        queryKindPermissions(
          object.kind,
          object.namespace ?? null,
          object.clusterId,
          object.group,
          object.version
        );
      }
      return buildObjectActionItems({
        object,
        context,
        handlers: buildControllerHandlers({
          object,
          useDefaultHandlers,
          handlerOverrides,
          perObjectHandlers,
          onAfterAction,
          onOpen,
          onOpenObjectMap,
          onNavigateView,
          onViewInvolvedObject,
          openWithObject,
          navigateToView,
          navigateToViewAvailable: navigateFallbackAvailable,
          setters: {
            setRestartTarget,
            setRollbackTarget,
            setScaleTarget: setScaleState,
            setScaleConfirmation,
            setDeleteTarget,
            setPortForwardTarget,
            setTriggerTarget,
            executeMutation,
          },
        }),
        permissions,
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
      navigateFallbackAvailable,
      useDefaultHandlers,
      executeMutation,
    ]
  );

  const confirmRestart = useCallback(async () => {
    const object = restartTarget;
    if (!object) {
      return;
    }
    try {
      await executeMutation(() => runObjectRestart(actionTargetFor(object, 'restart')));
      onAfterAction?.(object, 'restart');
    } catch (error) {
      errorHandler.handle(error, { action: 'restart', kind: object.kind, name: object.name });
    } finally {
      setRestartTarget(null);
    }
  }, [executeMutation, onAfterAction, restartTarget]);

  const confirmDelete = useCallback(async () => {
    const object = deleteTarget;
    if (!object) {
      return;
    }
    try {
      await executeMutation(() => runObjectDelete(actionTargetFor(object, 'delete')));
      onAfterDelete?.(object);
      onAfterAction?.(object, 'delete');
    } catch (error) {
      errorHandler.handle(error, { action: 'delete', kind: object.kind, name: object.name });
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, executeMutation, onAfterAction, onAfterDelete]);

  const confirmTrigger = useCallback(async () => {
    const object = triggerTarget;
    if (!object) {
      return;
    }
    try {
      await executeMutation(() => runCronJobTrigger(actionTargetFor(object, 'trigger')));
      onAfterAction?.(object, 'trigger');
    } catch (error) {
      errorHandler.handle(error, { action: 'trigger', kind: object.kind, name: object.name });
    } finally {
      setTriggerTarget(null);
    }
  }, [executeMutation, onAfterAction, triggerTarget]);

  const applyScaleValue = useCallback(
    async (replicas: number) => {
      const object = scaleState.object;
      if (!object) {
        return;
      }
      setScaleState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        await executeMutation(() => runObjectScale(actionTargetFor(object, 'scale'), replicas));
        onAfterAction?.(object, 'scale');
        setScaleState({ object: null, value: 1, loading: false, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setScaleState((previous) => ({ ...previous, loading: false, error: message }));
        errorHandler.handle(error, { action: 'scale', kind: object.kind, name: object.name });
      }
    },
    [executeMutation, onAfterAction, scaleState.object]
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
      await executeMutation(() => runObjectScale(actionTargetFor(object, 'scale'), replicas));
      onAfterAction?.(object, 'scale');
    } catch (error) {
      errorHandler.handle(error, { action: 'scale', kind: object.kind, name: object.name });
    } finally {
      setScaleConfirmation(null);
    }
  }, [executeMutation, onAfterAction, scaleConfirmation]);

  const requestFinalizerRemoval = useCallback(
    (
      object: ObjectActionData,
      finalizer: string,
      path: FinalizerPath,
      deletionTimestamp?: string
    ) => {
      setFinalizerRemovalTarget({ object, finalizer, path, deletionTimestamp });
    },
    []
  );

  const confirmFinalizerRemoval = useCallback(async () => {
    const target = finalizerRemovalTarget;
    if (!target) {
      return;
    }
    const { object, finalizer, path } = target;
    try {
      await executeMutation(() =>
        runObjectFinalizerRemoval(actionTargetFor(object, 'remove finalizer'), finalizer, path)
      );
      onAfterAction?.(object, 'removeFinalizer');
    } catch (error) {
      errorHandler.handle(error, {
        action: 'removeFinalizer',
        kind: object.kind,
        name: object.name,
      });
    } finally {
      setFinalizerRemovalTarget(null);
    }
  }, [executeMutation, finalizerRemovalTarget, onAfterAction]);

  const confirmation = useMemo(() => {
    if (finalizerRemovalTarget) {
      const { object, finalizer, deletionTimestamp } = finalizerRemovalTarget;
      return {
        title: 'Remove Finalizer',
        message: `Remove finalizer "${finalizer}" from ${object.kind.toLowerCase()} "${object.name}"?`,
        notice: deletionIsWithinFinalizerCleanupGrace(deletionTimestamp)
          ? RECENT_FINALIZER_REMOVAL_NOTICE
          : undefined,
        warning:
          'This may leave objects in an unknown or bad state. Only continue if the responsible controller cannot complete cleanup.',
        confirmText: 'Remove',
        confirmButtonClass: 'danger',
        onConfirm: confirmFinalizerRemoval,
        onCancel: () => setFinalizerRemovalTarget(null),
      };
    }
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
    confirmFinalizerRemoval,
    confirmRestart,
    confirmScaleToZero,
    confirmTrigger,
    deleteTarget,
    finalizerRemovalTarget,
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
          notice={confirmation?.notice}
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
        <PortForwardModal
          target={portForwardTarget}
          onClose={() => setPortForwardTarget(null)}
          onMutationChange={setNestedMutationInFlight}
        />
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
            onMutationChange={setNestedMutationInFlight}
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
      setNestedMutationInFlight,
    ]
  );

  return { getMenuItems, modals, requestFinalizerRemoval };
};
