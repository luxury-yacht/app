import { OBJECT_ACTION_IDS, type MutatingObjectActionId } from './objectActionDescriptors';
import { OBJECT_ACTIONS } from './objectActionClient';

export interface ObjectActionPermissionMatrixEntry {
  actionId: MutatingObjectActionId;
  frontendPermission: string;
  wailsMethod: string;
  backendPermission: string;
  deniedReason: string;
}

export const OBJECT_ACTION_PERMISSION_MATRIX: readonly ObjectActionPermissionMatrixEntry[] = [
  {
    actionId: OBJECT_ACTION_IDS.restart,
    frontendPermission: 'target workload patch',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.restart})`,
    backendPermission: 'resourcePermissionCheck(target-workload, patch)',
    deniedReason: 'restart permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.rollback,
    frontendPermission: 'target workload update',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.rollback}, revision)`,
    backendPermission: 'resourcePermissionCheck(target-workload, update)',
    deniedReason: 'rollback permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.scale,
    frontendPermission: 'target workload scale update',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.scale}, replicas)`,
    backendPermission: 'resourcePermissionCheck(target-workload-scale, update)',
    deniedReason: 'scale permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.scaleToZero,
    frontendPermission: 'target workload scale update',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.scale}, replicas)`,
    backendPermission: 'resourcePermissionCheck(target-workload-scale, update)',
    deniedReason: 'scale permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.resumeFromZero,
    frontendPermission: 'target workload scale update',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.scale}, replicas)`,
    backendPermission: 'resourcePermissionCheck(target-workload-scale, update)',
    deniedReason: 'scale permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.triggerNow,
    frontendPermission: 'batch/v1 Job create',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.trigger})`,
    backendPermission: 'resourcePermissionCheck(job, create)',
    deniedReason: 'trigger permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.suspend,
    frontendPermission: 'batch/v1 CronJob patch',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.suspend}, suspend)`,
    backendPermission: 'resourcePermissionCheck(cronjob, patch)',
    deniedReason: 'suspend permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.resume,
    frontendPermission: 'batch/v1 CronJob patch',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.suspend}, suspend)`,
    backendPermission: 'resourcePermissionCheck(cronjob, patch)',
    deniedReason: 'suspend permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.portForward,
    frontendPermission: 'core/v1 Pod portforward create',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.startPortForward}, portForward)`,
    backendPermission: 'resourcePermissionCheck(pod-portforward, create)',
    deniedReason: 'port-forward permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.cordon,
    frontendPermission: 'core/v1 Node get and patch',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.cordon})`,
    backendPermission:
      'resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch)',
    deniedReason: 'cordon permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.uncordon,
    frontendPermission: 'core/v1 Node get and patch',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.uncordon})`,
    backendPermission:
      'resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch)',
    deniedReason: 'cordon permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.drain,
    frontendPermission: 'core/v1 Node get+patch and Pod eviction create or Pod delete',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.startDrain}, drainOptions)`,
    backendPermission:
      'resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch) and resourcePermissionCheck(pod-eviction, create optional) and resourcePermissionCheck(pod-delete, delete optional)',
    deniedReason: 'drain permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.delete,
    frontendPermission: 'target object delete',
    wailsMethod: `RunObjectAction(${OBJECT_ACTIONS.delete})`,
    backendPermission: 'resourcePermissionCheck(target, delete)',
    deniedReason: 'delete permission state',
  },
];
