import { requestRefreshDomainState } from '@/core/data-access';
import {
  localFailure,
  permissionDeniedFailure,
  type RefreshFailure,
} from '@/core/refresh/refreshFailure';

export type QueryPageRequestResult = Awaited<ReturnType<typeof requestRefreshDomainState>>;

interface QueryPageRequestCallbacks {
  isCurrent: () => boolean;
  onResult: (result: QueryPageRequestResult) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
  // Browse reports failures in the same scope even after a quiet request was
  // superseded. Typed requests discard every outcome after cancellation.
  acceptsError?: () => boolean;
}

// A failed domain state that carries no failure of its own.
const SNAPSHOT_REQUEST_FAILED = localFailure('Snapshot request failed');

// The failure an executed read settled into its scope's state: the refresh
// layer resolves a failed read rather than rejecting it. A denial is settled
// like any other failure: no warm-up retries.
export const failureOfState = (
  state: { status?: string; error?: RefreshFailure | null; permissionDenied?: boolean } | undefined
): RefreshFailure | null => {
  const error = state?.error ?? null;
  if (state?.permissionDenied) {
    return permissionDeniedFailure(error);
  }
  return state?.status === 'error' ? (error ?? SNAPSHOT_REQUEST_FAILED) : null;
};

// Data access owns acquire/fetch/read/release. This boundary owns delivery to
// the current page session; adapters interpret blocked/warm-up/error payloads.
export async function executeQueryPageRequest(
  request: Parameters<typeof requestRefreshDomainState>[0],
  callbacks: QueryPageRequestCallbacks
): Promise<void> {
  try {
    const result = await requestRefreshDomainState(request);
    if (callbacks.isCurrent()) {
      callbacks.onResult(result);
    }
  } catch (error) {
    if ((callbacks.acceptsError ?? callbacks.isCurrent)()) {
      callbacks.onError(error);
    }
  } finally {
    callbacks.onSettled();
  }
}
