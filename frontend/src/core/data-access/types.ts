import type { RefreshDomain } from '@/core/refresh/types';

export type DataRequestReason = 'background' | 'startup' | 'user';

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
