/**
 * frontend/src/core/data-access/types.ts
 *
 * Defines shared request and response contracts for brokered data access.
 */

import type { RefreshDomain } from '@/core/refresh/types';
import type { RefreshContext } from '@/core/refresh/RefreshManager';
import type { DomainSnapshotState } from '@/core/refresh/store';
import type { DomainPayloadMap } from '@/core/refresh/types';

export type DataRequestReason = 'background' | 'startup' | 'user';
export type DataAccessAdapter =
  'refresh-domain' | 'context-refresh' | 'rpc-read' | 'permission-read' | 'capability-read';

export type DataBlockedReason = 'auto-refresh-disabled';

export interface RefreshDomainRequest {
  domain: RefreshDomain;
  scope: string;
  reason: DataRequestReason;
  resource?: string;
  label?: string;
}

export interface RefreshDomainStateRequest<
  K extends RefreshDomain = RefreshDomain,
> extends RefreshDomainRequest {
  domain: K;
  cleanup?: boolean;
  preserveState?: boolean;
}

export interface DataRequestResult {
  status: 'executed' | 'blocked';
  blockedReason?: DataBlockedReason;
}

export interface DataReadRequest<T> {
  resource: string;
  reason: DataRequestReason;
  adapter?: DataAccessAdapter;
  label?: string;
  scope?: string;
  read: () => Promise<T>;
}

export interface DataReadResult<T> extends DataRequestResult {
  data?: T;
}

export type RefreshDomainStateResult<K extends RefreshDomain = RefreshDomain> = DataReadResult<
  DomainSnapshotState<DomainPayloadMap[K]>
>;

export interface ContextRefreshRequest {
  reason: DataRequestReason;
  context?: Partial<RefreshContext>;
  resource?: string;
  label?: string;
  scope?: string;
}
