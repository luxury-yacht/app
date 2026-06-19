/**
 * frontend/src/modules/object-panel/components/ObjectPanel/types.ts
 *
 * Type definitions for types.
 * Defines shared interfaces and payload shapes for the object panel feature.
 */
import type { ResourceRef } from '@core/refresh/types';

type NullableResourceRefFields = {
  [K in keyof ResourceRef]?: ResourceRef[K] | null;
};

export type PanelObjectData = NullableResourceRefFields & {
  kindAlias?: string | null;
  clusterName?: string | null;
};

export type ResourceCapability = {
  objPanelLogs?: boolean;
  nodeLogs?: boolean;
  delete?: boolean;
  restart?: boolean;
  scale?: boolean;
  edit?: boolean;
  shell?: boolean;
  debug?: boolean;
  trigger?: boolean;
  suspend?: boolean;
};

export type FeatureSupport = {
  objPanelLogs: boolean;
  nodeLogs: boolean;
  manifest: boolean;
  values: boolean;
  delete: boolean;
  restart: boolean;
  scale: boolean;
  edit: boolean;
  shell: boolean;
  debug: boolean;
  trigger: boolean;
  suspend: boolean;
};

export type ComputedCapabilities = {
  hasObjPanelLogs: boolean;
  hasNodeLogs: boolean;
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
  viewObjPanelLogs?: string;
  viewManifest?: string;
  viewValues?: string;
  delete?: string;
  restart?: string;
  scale?: string;
  trigger?: string;
  suspend?: string;
  shell?: string;
  shellExecGet?: string;
  shellExecCreate?: string;
  debug?: string;
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
  trigger: CapabilityState;
  suspend: CapabilityState;
  shell: CapabilityState;
  debug: CapabilityState;
};

export type NodeLogsState = CapabilityState;

export type CapabilityReasons = {
  nodeLogs?: string;
  delete?: string;
  restart?: string;
  scale?: string;
  trigger?: string;
  suspend?: string;
  editYaml?: string;
  shell?: string;
  debug?: string;
};

export const createEmptyCapabilityIdMap = (): CapabilityIdMap => ({
  viewYaml: undefined,
  editYaml: undefined,
  viewObjPanelLogs: undefined,
  viewManifest: undefined,
  viewValues: undefined,
  delete: undefined,
  restart: undefined,
  scale: undefined,
  shell: undefined,
  shellExecGet: undefined,
  shellExecCreate: undefined,
  debug: undefined,
});

export type ViewType =
  | 'details'
  | 'logs'
  | 'shell'
  | 'pods'
  | 'jobs'
  | 'events'
  | 'yaml'
  | 'map'
  | 'manifest'
  | 'values';

export type LogDisplayMode = 'raw' | 'structured' | 'pretty' | 'parsed';

export type LogTimestampMode = 'hidden' | 'default' | 'short' | 'localized';

/**
 * Persistent subset of LogViewerState — the user-facing view preferences
 * that should survive ObjectPanelContent unmount/remount caused by
 * cluster switching. Stored outside React state in a module-level cache
 * (logViewerPrefsCache) keyed by panelId, evicted by
 * ObjectPanelStateContext when the panel actually closes.
 *
 * Pure-derived state (containers, parsedContainerLogs, fallbackError, etc.) is
 * NOT included — those get recomputed from the cached log entries on
 * remount. expandedRows is stored as an array because the in-memory Set
 * is rebuilt by applyLogViewerPrefs on rehydrate; using an array keeps
 * the snapshot trivially copyable.
 */
export interface LogViewerPrefs {
  selectedContainer: string;
  selectedFilters: string[];
  autoRefresh: boolean;
  timestampMode: LogTimestampMode;
  showTimestamps: boolean;
  wrapText: boolean;
  showAnsiColors?: boolean;
  textFilter: string;
  highlightMatches: boolean;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
  displayMode: LogDisplayMode;
  isParsedView: boolean;
  expandedRows: string[];
  showPreviousContainerLogs: boolean;
}
