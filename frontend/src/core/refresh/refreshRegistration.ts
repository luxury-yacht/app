import type { DomainCategory } from './domainRegistry';
import type { RefreshDomain } from './types';

export type StreamingRegistration = {
  start: (scope: string) => Promise<void>;
  stop?: (scope: string, options?: { reset?: boolean }) => void;
  refreshOnce?: (scope: string) => Promise<void>;
  // No snapshot endpoint backs this domain (its data flows only through its
  // own stream, e.g. container-logs) — the orchestrator must never issue
  // snapshot fetches for it; the backend answers them "unknown domain".
  snapshotless?: boolean;
};

export type DomainRegistration<K extends RefreshDomain> = {
  domain: K;
  category: DomainCategory;
  streaming?: StreamingRegistration;
};

export type RefreshDomainRegistrar = {
  registerDomain<K extends RefreshDomain>(config: DomainRegistration<K>): void;
};
