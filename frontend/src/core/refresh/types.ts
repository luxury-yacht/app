/**
 * Public refresh contract boundary.
 *
 * Backend HTTP and stream DTOs, enums, domain names, and backend domain payload
 * mappings are generated from Go into types.generated.ts. Keep frontend-owned
 * reducer state here and compose it with the generated map so existing imports
 * remain stable.
 */

export * from './types.generated';

import type {
  BackendDomainPayloadMap,
  CatalogSnapshotPayload,
  ContainerLogsWireEntry,
  RefreshPermissionDeniedDetails,
  RefreshPermissionDeniedStatus,
  SnapshotStats,
} from './types.generated';

// Error parsing also accepts Kubernetes Status-shaped details that do not
// originate in the refresh server. Keep that permissive input boundary
// separate from the exact generated refresh error DTO.
export interface PermissionDeniedDetails extends Partial<RefreshPermissionDeniedDetails> {
  kind?: string;
  name?: string;
}

export interface PermissionDeniedStatus extends Partial<
  Omit<RefreshPermissionDeniedStatus, 'details'>
> {
  details?: PermissionDeniedDetails;
}

// Catalog streaming is a frontend merge protocol layered over catalog
// snapshots. The current backend catalog endpoint serves snapshots; this shape
// remains frontend-owned until a backend stream publishes the protocol.
export type CatalogStreamSnapshotMode = 'full' | 'partial';

export interface CatalogStreamEventPayload {
  reset?: boolean;
  ready?: boolean;
  cacheReady: boolean;
  truncated: boolean;
  snapshotMode: CatalogStreamSnapshotMode;
  snapshot: CatalogSnapshotPayload;
  stats: SnapshotStats;
  generatedAt: number;
  sequence: number;
}

// The backend owns the log-line wire fields. `_seq` is assigned by the
// frontend reducer to provide stable rendering keys.
export interface ContainerLogsEntry extends ContainerLogsWireEntry {
  _seq?: number;
}

export interface ContainerLogsSnapshotPayload {
  entries: ContainerLogsEntry[];
  sequence: number;
  generatedAt: number;
  resetCount: number;
  error?: string | null;
}

export type DomainPayloadMap = BackendDomainPayloadMap & {
  'container-logs': ContainerLogsSnapshotPayload;
};
