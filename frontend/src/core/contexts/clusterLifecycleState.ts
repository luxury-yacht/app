/**
 * frontend/src/core/contexts/clusterLifecycleState.ts
 *
 * The closed set of cluster lifecycle states the backend can emit (mirrors the
 * Go `ClusterLifecycleState` constants in backend/cluster_lifecycle.go). Wails
 * flattens the Go defined type to `string`, so the frontend owns this union and
 * coerces raw payloads through {@link parseClusterLifecycleState} at the
 * ingestion boundary (ClusterLifecycleContext); everything downstream of that
 * boundary sees only these values. "Untracked" is represented as absence
 * (undefined), never as a member of the union.
 */

export type ClusterLifecycleState =
  | 'connecting'
  | 'auth_failed'
  | 'connected'
  | 'loading'
  | 'loading_slow'
  | 'ready'
  | 'disconnected'
  | 'reconnecting';

export const CLUSTER_LIFECYCLE_STATES: ReadonlySet<string> = new Set<ClusterLifecycleState>([
  'connecting',
  'auth_failed',
  'connected',
  'loading',
  'loading_slow',
  'ready',
  'disconnected',
  'reconnecting',
]);

// Log each distinct unrecognized state at most once per session (the backend
// emitter is typed, so this should only fire on backend/frontend version skew).
const warnedUnknownStates = new Set<string>();

/**
 * Coerce a raw lifecycle state string into the closed union. Returns undefined
 * for absence ('' is the wire form of "no previous state") and for unknown
 * values, warning once per distinct unknown value. Callers drop transitions
 * that parse to undefined: there is no benign fallback state — mapping an
 * unknown value onto a concrete state would either hold refresh dispatch (the
 * unserviceable states) or fake readiness. Dropping keeps the last known state,
 * matching clusterReadiness's documented fail-open handling of unknown clusters.
 */
export function parseClusterLifecycleState(
  raw: string | null | undefined
): ClusterLifecycleState | undefined {
  if (!raw) {
    return undefined;
  }
  if (CLUSTER_LIFECYCLE_STATES.has(raw)) {
    return raw as ClusterLifecycleState;
  }
  if (!warnedUnknownStates.has(raw)) {
    warnedUnknownStates.add(raw);
    console.warn(`Unrecognized cluster lifecycle state "${raw}"; ignoring the transition.`);
  }
  return undefined;
}
