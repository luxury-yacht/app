import type { GridTableFocusRequest } from '@shared/components/tables/hooks/gridTableFocusRequest';
import { peekPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { errorHandler } from '@utils/errorHandler';
import type {
  RefreshDomain,
  ResourceQueryAnchor,
  ResourceQueryAnchorReason,
} from '@/core/refresh/types';

export type AnchorableFocusRequest = GridTableFocusRequest & { version: string };

const hasVersion = (request: GridTableFocusRequest): request is AnchorableFocusRequest =>
  Boolean(request.version);

// Only the destination can issue the anchor. Requests without a version can
// still match a row on the current page using the normal GridTable behavior.
export const pendingAnchorRequest = (
  clusterId: string | null | undefined,
  viewId: string | undefined,
  namespace?: string
): AnchorableFocusRequest | null => {
  const request = peekPendingFocusRequest();
  if (
    !request ||
    !viewId ||
    request.clusterId !== clusterId ||
    request.destinationViewId !== viewId ||
    (namespace !== undefined && request.namespace !== namespace)
  ) {
    return null;
  }
  return hasVersion(request) ? request : null;
};

export const focusRequestAnchor = (request: AnchorableFocusRequest): ResourceQueryAnchor => ({
  clusterId: request.clusterId,
  group: request.group ?? '',
  version: request.version,
  kind: request.kind,
  namespace: request.namespace,
  name: request.name,
  uid: request.uid,
});

const MISSING_FOCUS_TARGET_REASONS: Record<ResourceQueryAnchorReason, string> = {
  filtered: 'is not shown: the current filters exclude it',
  'not-found': 'was not found — it may have been deleted',
  unlisted: 'exists, but this view has no row for it',
  unavailable: 'could not be verified in the object catalog',
};

export const reportMissingFocusTarget = (
  domain: RefreshDomain,
  request: GridTableFocusRequest | null,
  reason: ResourceQueryAnchorReason | undefined
): void => {
  let target = 'The requested object';
  if (request) {
    const namespacedName = request.namespace
      ? `${request.namespace}/${request.name}`
      : request.name;
    target = `${request.kind} ${namespacedName}`;
  }
  errorHandler.handle(
    new Error(`${target} ${MISSING_FOCUS_TARGET_REASONS[reason ?? 'not-found']}`),
    {
      source: 'resource-grid-anchor',
      domain,
    }
  );
};
