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
  CanonicalResourceRef,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
  ContainerLogsWireEntry,
  RefreshPermissionDeniedDetails,
  RefreshPermissionDeniedStatus,
} from './types.generated';

/** Test-fixture patch shape for canonical rows whose required ref is assembled by a builder. */
export type CanonicalRowTestOverrides<T extends { ref: CanonicalResourceRef }> = Omit<
  Partial<T>,
  'ref'
> & { ref?: Partial<CanonicalResourceRef> };

// Error parsing also accepts Kubernetes Status-shaped details that do not
// originate in the refresh server. Keep that permissive input boundary
// separate from the exact generated refresh error DTO.
export interface PermissionDeniedDetails extends Partial<RefreshPermissionDeniedDetails> {
  kind?: string;
  name?: string;
}

export interface PermissionDeniedStatus
  extends Partial<Omit<RefreshPermissionDeniedStatus, 'details'>> {
  details?: PermissionDeniedDetails;
}

// The backend owns the log-line wire fields. `_seq` is assigned by the
// frontend reducer to provide stable rendering keys.
export interface ContainerLogsEntry extends ContainerLogsWireEntry {
  _seq?: number;
}

// Where a container-logs stream is in its lifecycle. `attempt` counts
// reconnects since the last delivered snapshot.
export type ContainerLogsStreamPhase =
  | { status: 'connecting' }
  | { status: 'awaiting-snapshot' }
  | { status: 'live' }
  | { status: 'reconnecting'; attempt: number; reason: string }
  | { status: 'failed'; reason: string; permissionDenied: boolean; retryable: boolean }
  | { status: 'stopping' };

export interface ContainerLogsSnapshotPayload {
  entries: ContainerLogsEntry[];
  sequence: number;
  generatedAt: number;
  resetCount: number;
  error?: string | null;
  phase: ContainerLogsStreamPhase;
  warnings: ContainerLogsWarning[];
  issues: ContainerLogsTargetIssue[];
  // Set once the buffer has left out entries: it holds `shown` of the
  // `received` entries delivered since the last snapshot. `received` is not the
  // container's total log size.
  truncation: { shown: number; received: number } | null;
  // The pods that have lines in the buffer; the same array until that set
  // changes.
  pods: string[];
}

export type DomainPayloadMap = BackendDomainPayloadMap & {
  'container-logs': ContainerLogsSnapshotPayload;
};
