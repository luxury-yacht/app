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
  ContainerLogsWireEntry,
  RefreshPermissionDeniedDetails,
  RefreshPermissionDeniedStatus,
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
