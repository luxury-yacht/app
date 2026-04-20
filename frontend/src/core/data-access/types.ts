import type { RefreshDomain } from '@/core/refresh/types';
import type { RefreshContext } from '@/core/refresh/RefreshManager';

export type DataRequestReason = 'background' | 'startup' | 'user';
export type DataAccessAdapter =
  | 'refresh-domain'
  | 'context-refresh'
  | 'rpc-read'
  | 'permission-read'
  | 'capability-read';

export type DataBlockedReason = 'auto-refresh-disabled';

export interface RefreshDomainRequest {
  domain: RefreshDomain;
  scope: string;
  reason: DataRequestReason;
  resource?: string;
}

export interface DataRequestResult {
  status: 'executed' | 'blocked';
  blockedReason?: DataBlockedReason;
}

export interface DataReadRequest<T> {
  resource: string;
  reason: DataRequestReason;
  adapter?: DataAccessAdapter;
  read: () => Promise<T>;
}

export interface DataReadResult<T> extends DataRequestResult {
  data?: T;
}

export interface ContextRefreshRequest {
  reason: DataRequestReason;
  context?: Partial<RefreshContext>;
}
