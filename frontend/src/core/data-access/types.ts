/**
 * frontend/src/core/data-access/types.ts
 *
 * Defines shared request and response contracts for brokered data access.
 */

import type { RefreshContext } from '@/core/refresh/RefreshManager';
import type { DomainSnapshotState } from '@/core/refresh/store';
import type { DomainPayloadMap, RefreshDomain } from '@/core/refresh/types';

// 'stream-signal' marks a fetch triggered by a stream doorbell: auto-refresh
// gating applies (paused means paused), but the orchestrator must not skip it
// for a healthy stream — the signal is the stream announcing changed data.
export type DataRequestReason = 'background' | 'startup' | 'foreground' | 'user' | 'stream-signal';
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
  label?: string;
}

export interface RefreshDomainStateRequest<K extends RefreshDomain = RefreshDomain>
  extends RefreshDomainRequest {
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
  reason: 'user';
  context?: Partial<RefreshContext>;
  resource?: string;
  label?: string;
  scope?: string;
}
