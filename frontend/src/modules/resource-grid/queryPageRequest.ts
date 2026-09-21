import { requestRefreshDomainState } from '@/core/data-access';

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
