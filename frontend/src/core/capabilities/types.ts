export type CapabilityStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Descriptor for an individual capability check the UI wants to evaluate.
 * Properties mirror the backend contract with `EvaluateCapabilities`.
 */
export interface CapabilityDescriptor {
  id: string;
  verb: string;
  resourceKind: string;
  namespace?: string;
  name?: string;
  subresource?: string;
}

/**
 * Normalised descriptor with canonical casing/whitespace trimming applied.
 */
export interface NormalizedCapabilityDescriptor {
  id: string;
  verb: string;
  resourceKind: string;
  namespace?: string;
  name?: string;
  subresource?: string;
}

/**
 * Runtime state tracked for each capability request.
 */
export interface CapabilityEntry {
  key: string;
  request: NormalizedCapabilityDescriptor;
  status: CapabilityStatus;
  result?: CapabilityResult;
  error?: string | null;
  lastFetched?: number;
}

/**
 * Capability check outcome returned by the backend.
 */
export interface CapabilityResult {
  id: string;
  verb: string;
  resourceKind: string;
  namespace?: string;
  name?: string;
  subresource?: string;
  allowed: boolean;
  deniedReason?: string;
  evaluationError?: string;
  error?: string;
}

export interface CapabilityState {
  allowed: boolean;
  pending: boolean;
  status: CapabilityStatus;
  reason?: string;
}

export interface CapabilityNamespaceDiagnostics {
  key: string;
  namespace?: string;
  pendingCount: number;
  inFlightCount: number;
  inFlightStartedAt?: number;
  lastRunDurationMs?: number;
  lastRunCompletedAt?: number;
  lastError?: string | null;
  lastResult?: 'success' | 'error';
  totalChecks?: number;
  consecutiveFailureCount: number;
  lastDescriptors: NormalizedCapabilityDescriptor[];
}
