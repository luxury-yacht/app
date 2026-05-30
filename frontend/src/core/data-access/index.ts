/**
 * frontend/src/core/data-access/index.ts
 *
 * Public entrypoint for brokered data reads, typed backend readers, and
 * refresh-domain lifecycle helpers used outside the core data-access package.
 */

export {
  requestContextRefresh,
  requestData,
  requestRefreshDomain,
  requestRefreshDomainState,
} from './dataAccess';
export { useRefreshDomainHandle } from './useRefreshDomainHandle';
export { useScopedRefreshDomainLifecycle } from './useScopedRefreshDomainLifecycle';
export * from './readers';
export type {
  DataAccessAdapter,
  ContextRefreshRequest,
  DataBlockedReason,
  DataReadRequest,
  DataReadResult,
  DataRequestReason,
  DataRequestResult,
  RefreshDomainRequest,
  RefreshDomainStateRequest,
  RefreshDomainStateResult,
} from './types';
