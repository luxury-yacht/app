/**
 * frontend/src/shared/actions/objectActionDescriptors.ts
 *
 * Stable object-action ids and labels shared by context menus, actions menus,
 * and tests. Use ids for behavior; labels are user-facing copy only.
 */

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
