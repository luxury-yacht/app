/**
 * frontend/src/shared/components/resourceBarThresholds.ts
 *
 * Usage-color thresholds for capacity-scaled resource bars (bars with an
 * allocatable value): below HIGH is normal, HIGH up to CRITICAL is high
 * pressure, at or above CRITICAL is critical. A separate module (rather than
 * ResourceBar exports) so the cluster-overview legend can state the same
 * numbers without importing the component, which tests mock wholesale.
 * ResourceBar's no-allocatable branch keys on requests/limits with its own
 * thresholds and is deliberately not described by these constants.
 */
export const USAGE_HIGH_THRESHOLD_PERCENT = 81;
export const USAGE_CRITICAL_THRESHOLD_PERCENT = 95;
