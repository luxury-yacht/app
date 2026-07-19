import type { DomainCategory } from './domainRegistry';
import type { RefresherName } from './refresherTypes';
import type { RefreshDomain } from './types';

export type StreamingRegistration = {
  start: (scope: string) => Promise<(() => void) | undefined> | (() => void);
  stop?: (scope: string, options?: { reset?: boolean }) => void;
  refreshOnce?: (scope: string) => Promise<void>;
  // Pause scheduled polling while streaming is active; resume polling as a fallback when it stops.
  pauseRefresherWhenStreaming?: boolean;
  // No snapshot endpoint backs this domain (its data flows only through its
  // own stream, e.g. container-logs) — the orchestrator must never issue
  // snapshot fetches for it; the backend answers them "unknown domain".
  snapshotless?: boolean;
};

export type DomainRegistration<K extends RefreshDomain> = {
  domain: K;
  refresherName: RefresherName;
  category: DomainCategory;
  streaming?: StreamingRegistration;
  // False when a feature owns a scope-specific scheduler with a different
  // cadence (object-details uses one refresher per open panel).
  scheduled?: boolean;
};

export type RefreshDomainRegistrar = {
  registerDomain<K extends RefreshDomain>(config: DomainRegistration<K>): void;
};
