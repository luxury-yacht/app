import type { DomainCategory } from './domainRegistry';
import type { RefresherName } from './refresherTypes';
import type { RefreshDomain } from './types';

export type StreamingRegistration = {
  start: (scope: string) => Promise<(() => void) | void> | (() => void);
  stop?: (scope: string, options?: { reset?: boolean }) => void;
  refreshOnce?: (scope: string) => Promise<void>;
  metricsOnly?: boolean;
  // Pause scheduled polling while streaming is active; resume polling as a fallback when it stops.
  pauseRefresherWhenStreaming?: boolean;
};

export type DomainRegistration<K extends RefreshDomain> = {
  domain: K;
  refresherName: RefresherName;
  category: DomainCategory;
  streaming?: StreamingRegistration;
};

export type RefreshDomainRegistrar = {
  registerDomain<K extends RefreshDomain>(config: DomainRegistration<K>): void;
};
