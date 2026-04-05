/**
 * Types for the SSRR permission system.
 */

/** A lightweight permission check descriptor. Static data — no store state. */
export interface PermissionSpec {
  kind: string;
  verb: string;
  subresource?: string;
}

/** A stored permission check result from the backend. */
export interface PermissionEntry {
  allowed: boolean;
  /** "ssrr" | "ssar" | "denied" | "error" — from PermissionResult.Source */
  source: string;
  /** Denial reason or error message, for UI display */
  reason: string | null;
  /** Query metadata — needed to populate PermissionStatus for consumers */
  descriptor: {
    clusterId: string;
    resourceKind: string;
    verb: string;
    namespace: string | null;
    subresource: string | null;
  };
  /** Which permission list produced this query (e.g., "workloads", "cluster") */
  feature?: string;
}

/** The public permission status exposed via useUserPermissions(). */
export interface PermissionStatus {
  id: string;
  allowed: boolean;
  pending: boolean;
  reason: string | null;
  error: string | null;
  source: 'ssrr' | 'ssar' | 'denied' | 'error' | null;
  descriptor: {
    clusterId: string;
    resourceKind: string;
    verb: string;
    namespace: string | null;
    subresource: string | null;
  };
  feature?: string;
  entry: {
    status: 'loading' | 'ready' | 'error';
  };
}

/** Per-namespace batch diagnostics for the diagnostics panel. */
export interface PermissionQueryDiagnostics {
  key: string;
  clusterId?: string;
  namespace?: string;
  method: 'ssrr' | 'ssar';
  pendingCount: number;
  inFlightCount: number;
  inFlightStartedAt?: number;
  lastRunDurationMs?: number;
  lastRunCompletedAt?: number;
  lastError?: string | null;
  lastResult?: 'success' | 'error';
  totalChecks: number;
  consecutiveFailureCount: number;
  ssrrIncomplete?: boolean;
  ssrrRuleCount?: number;
  ssarFallbackCount?: number;
  /** Descriptors in the last query batch. Uses the shape DiagnosticsPanel expects. */
  lastDescriptors: Array<{
    resourceKind: string;
    verb: string;
    namespace?: string;
    subresource?: string;
  }>;
}

export type PermissionKey = string;
export type PermissionMap = Map<PermissionKey, PermissionStatus>;
