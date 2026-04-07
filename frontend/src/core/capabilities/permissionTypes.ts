/**
 * Types for the SSRR permission system.
 */

/** A lightweight permission check descriptor. Static data — no store state.
 *
 * `group` and `version` are optional and identify the API group/version
 * for the kind. Static permission spec lists for built-in resources can
 * leave them undefined — the backend resolves built-in kinds correctly
 * because they don't collide. CRD-targeted spec entries (or lazy
 * `queryKindPermissions` calls) MUST populate them so the backend can
 * disambiguate colliding kinds.
 */
export interface PermissionSpec {
  kind: string;
  verb: string;
  subresource?: string;
  group?: string;
  version?: string;
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
    group: string | null;
    version: string | null;
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
    group: string | null;
    version: string | null;
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
