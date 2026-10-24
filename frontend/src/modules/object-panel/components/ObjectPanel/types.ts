/**
 * frontend/src/modules/object-panel/components/ObjectPanel/types.ts
 *
 * Type definitions for types.
 * Defines shared interfaces and payload shapes for the object panel feature.
 */
import type { ResourceRef } from '@core/refresh/types';
import type { MultiSelectFilterSelection } from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { KindPanelLogs, KindPanelShell } from '@shared/kinds/kindFacets';

type NullableResourceRefFields = {
  [K in keyof ResourceRef]?: ResourceRef[K] | null;
};

export type PanelObjectData = NullableResourceRefFields & {
  kindAlias?: string | null;
  clusterName?: string | null;
};

/** The panel features the object's kind supports, from its kind facets. */
export type FeatureSupport = {
  logs: KindPanelLogs;
  shell: KindPanelShell;
  debug: boolean;
  edit: boolean;
};

export type ComputedCapabilities = {
  hasObjPanelLogs: boolean;
  hasShell: boolean;
  canEditYaml: boolean;
};

export type CapabilityIdMap = {
  viewYaml?: string;
  editYaml?: string;
  viewObjPanelLogs?: string;
  shell?: string;
  /** Shell permission ids that must all be allowed. */
  shellAllOf: string[];
  /** Shell permission ids of which one must be allowed (alternative stream verbs). */
  shellAnyOf: string[];
  debug?: string;
  removeFinalizer?: string;
  removeNamespaceFinalizer?: string;
};

export type CapabilityState = {
  allowed: boolean;
  pending: boolean;
  reason?: string;
};

export type CapabilityStates = {
  viewYaml: CapabilityState;
  editYaml: CapabilityState;
  shell: CapabilityState;
  debug: CapabilityState;
  removeFinalizer: CapabilityState;
  removeNamespaceFinalizer: CapabilityState;
};

export type CapabilityReasons = {
  nodeLogs?: string;
  editYaml?: string;
  shell?: string;
  debug?: string;
};

export const createEmptyCapabilityIdMap = (): CapabilityIdMap => ({
  viewYaml: undefined,
  editYaml: undefined,
  viewObjPanelLogs: undefined,
  shell: undefined,
  shellAllOf: [],
  shellAnyOf: [],
  debug: undefined,
  removeFinalizer: undefined,
  removeNamespaceFinalizer: undefined,
});

export type ViewType =
  | 'details'
  | 'logs'
  | 'shell'
  | 'pods'
  | 'jobs'
  | 'events'
  | 'metrics'
  | 'yaml'
  | 'map'
  | 'manifest'
  | 'values';

export type LogDisplayMode = 'raw' | 'pretty' | 'parsed';

/** What the text filter does: show every line, only matching lines, or only the others. */
export type LogFilterMode = 'all' | 'filtered' | 'invert';

/**
 * Persistent subset of LogViewerState — the user-facing view preferences
 * that should survive ObjectPanelContent unmount/remount caused by
 * cluster switching. Stored outside React state in a module-level cache
 * (logViewerPrefsCache) keyed by panelId, evicted by
 * ObjectPanelStateContext when the panel actually closes.
 *
 * Pure-derived state (containers, parsed rows, etc.) is
 * NOT included — those get recomputed from the cached log entries on
 * remount. expandedRows is stored as an array because the in-memory Set
 * is rebuilt by applyLogViewerPrefs on rehydrate; using an array keeps
 * the snapshot trivially copyable.
 */
export interface LogViewerPrefs {
  selectedFilters: MultiSelectFilterSelection;
  autoRefresh: boolean;
  searchOpen: boolean;
  showTimestamps: boolean;
  wrapText: boolean;
  showAnsiColors?: boolean;
  textFilter: string;
  filterMode: LogFilterMode;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
  displayMode: LogDisplayMode;
  expandedRows: string[];
  showPreviousContainerLogs: boolean;
}
