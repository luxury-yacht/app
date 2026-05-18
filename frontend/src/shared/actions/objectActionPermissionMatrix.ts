import { OBJECT_ACTION_IDS, type ObjectActionId } from './objectActionDescriptors';

export interface ObjectActionPermissionMatrixEntry {
  actionId: ObjectActionId;
  frontendPermission: string;
  wailsMethod: string;
  backendPermission: string;
  deniedReason: string;
}

export const OBJECT_ACTION_PERMISSION_MATRIX: ObjectActionPermissionMatrixEntry[] = [
  {
    actionId: OBJECT_ACTION_IDS.restart,
    frontendPermission: 'target workload patch',
    wailsMethod: 'RestartWorkload',
    backendPermission: 'resourcePermissionCheck(target workload, patch)',
    deniedReason: 'restart permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.rollback,
    frontendPermission: 'target workload update',
    wailsMethod: 'RollbackWorkload',
    backendPermission: 'resourcePermissionCheck(target workload, update)',
    deniedReason: 'rollback permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.scale,
    frontendPermission: 'target workload scale update',
    wailsMethod: 'ScaleWorkload',
    backendPermission: 'resourcePermissionCheck(target workload/scale, update)',
    deniedReason: 'scale permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.triggerNow,
    frontendPermission: 'batch/v1 Job create',
    wailsMethod: 'TriggerCronJob',
    backendPermission: 'resourcePermissionCheck(Job, create)',
    deniedReason: 'trigger permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.suspend,
    frontendPermission: 'batch/v1 CronJob patch',
    wailsMethod: 'SuspendCronJob',
    backendPermission: 'resourcePermissionCheck(CronJob, patch)',
    deniedReason: 'suspend permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.resume,
    frontendPermission: 'batch/v1 CronJob patch',
    wailsMethod: 'SuspendCronJob',
    backendPermission: 'resourcePermissionCheck(CronJob, patch)',
    deniedReason: 'suspend permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.portForward,
    frontendPermission: 'core/v1 Pod portforward create',
    wailsMethod: 'StartPortForward',
    backendPermission: 'resourcePermissionCheck(Pod/portforward, create)',
    deniedReason: 'port-forward permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.cordon,
    frontendPermission: 'core/v1 Node get and patch',
    wailsMethod: 'CordonNode',
    backendPermission:
      'resourcePermissionCheck(Node, get) and resourcePermissionCheck(Node, patch)',
    deniedReason: 'cordon permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.uncordon,
    frontendPermission: 'core/v1 Node get and patch',
    wailsMethod: 'UncordonNode',
    backendPermission:
      'resourcePermissionCheck(Node, get) and resourcePermissionCheck(Node, patch)',
    deniedReason: 'cordon permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.drain,
    frontendPermission: 'core/v1 Node get+patch and Pod eviction create or Pod delete',
    wailsMethod: 'StartDrainNode',
    backendPermission:
      'resourcePermissionCheck(Node, get), resourcePermissionCheck(Node, patch), and drain pod permission',
    deniedReason: 'drain permission state',
  },
  {
    actionId: OBJECT_ACTION_IDS.delete,
    frontendPermission: 'target object delete',
    wailsMethod: 'DeleteResourceByGVK or resource-specific delete',
    backendPermission: 'resourcePermissionCheck(target object, delete)',
    deniedReason: 'delete permission state',
  },
];
