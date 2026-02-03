/**
 * frontend/src/modules/object-panel/components/ObjectPanel/types.ts
 *
 * Type definitions for types.
 * Defines shared interfaces and payload shapes for the object panel feature.
 */

export type PanelObjectData = {
  kind?: string | null;
  kindAlias?: string | null;
  name?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  clusterName?: string | null;
};

export type ResourceCapability = {
  logs?: boolean;
  delete?: boolean;
  restart?: boolean;
  scale?: boolean;
  edit?: boolean;
  shell?: boolean;
  trigger?: boolean;
  suspend?: boolean;
};

export type FeatureSupport = {
  logs: boolean;
  manifest: boolean;
  values: boolean;
  delete: boolean;
  restart: boolean;
  scale: boolean;
  edit: boolean;
  shell: boolean;
  trigger: boolean;
  suspend: boolean;
};

export type ComputedCapabilities = {
  hasLogs: boolean;
  hasShell: boolean;
  hasManifest: boolean;
  hasValues: boolean;
  canDelete: boolean;
  canRestart: boolean;
  canScale: boolean;
  canEditYaml: boolean;
  canTrigger: boolean;
  canSuspend: boolean;
};

export type CapabilityIdMap = {
  viewYaml?: string;
  editYaml?: string;
  viewLogs?: string;
  viewManifest?: string;
  viewValues?: string;
  delete?: string;
  restart?: string;
  scale?: string;
  shell?: string;
};

export type CapabilityState = {
  allowed: boolean;
  pending: boolean;
  reason?: string;
};

export type CapabilityStates = {
  viewYaml: CapabilityState;
  editYaml: CapabilityState;
  viewManifest: CapabilityState;
  viewValues: CapabilityState;
  delete: CapabilityState;
  restart: CapabilityState;
  scale: CapabilityState;
  shell: CapabilityState;
};

export type CapabilityReasons = {
  delete?: string;
  restart?: string;
  scale?: string;
  editYaml?: string;
  shell?: string;
};

export const createEmptyCapabilityIdMap = (): CapabilityIdMap => ({
  viewYaml: undefined,
  editYaml: undefined,
  viewLogs: undefined,
  viewManifest: undefined,
  viewValues: undefined,
  delete: undefined,
  restart: undefined,
  scale: undefined,
  shell: undefined,
});

export type ViewType =
  | 'details'
  | 'logs'
  | 'shell'
  | 'pods'
  | 'events'
  | 'yaml'
  | 'manifest'
  | 'values'
  | 'maintenance';

export type PanelState = {
  // UI state
  activeTab: ViewType;

  // Action state
  actionLoading: boolean;
  actionError: string | null;
  scaleReplicas: number;
  showScaleInput: boolean;
  showRestartConfirm: boolean;
  showDeleteConfirm: boolean;

  // Resource deletion state
  resourceDeleted: boolean;
  deletedResourceName: string;
};

export type PanelAction =
  | { type: 'SET_ACTIVE_TAB'; payload: ViewType }
  | { type: 'SET_ACTION_LOADING'; payload: boolean }
  | { type: 'SET_ACTION_ERROR'; payload: string | null }
  | { type: 'SET_SCALE_REPLICAS'; payload: number }
  | { type: 'SHOW_SCALE_INPUT'; payload: boolean }
  | { type: 'SHOW_RESTART_CONFIRM'; payload: boolean }
  | { type: 'SHOW_DELETE_CONFIRM'; payload: boolean }
  | { type: 'SET_RESOURCE_DELETED'; payload: { deleted: boolean; name: string } }
  | { type: 'RESET_STATE' };

export type ResourceAction = 'restart' | 'delete' | 'scale';
