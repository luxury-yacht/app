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
  scaleHpaManaged: 'scale-hpa-managed',
  portForward: 'port-forward',
  delete: 'delete',
} as const;

export type ObjectActionId = (typeof OBJECT_ACTION_IDS)[keyof typeof OBJECT_ACTION_IDS];

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
  [OBJECT_ACTION_IDS.scaleHpaManaged]: 'Scale (HPA managed)',
  [OBJECT_ACTION_IDS.portForward]: 'Port Forward',
  [OBJECT_ACTION_IDS.delete]: 'Delete',
};

export const objectActionLabel = (id: ObjectActionId): string => OBJECT_ACTION_LABELS[id];

export const objectActionInvolvedObjectLabel = (kind: string): string => `View ${kind}`;
