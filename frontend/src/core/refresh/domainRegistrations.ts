import { frontendRefreshDomainPolicies, type RefreshOrchestratorKind } from './domainRegistry';
import type { RefreshDomainRegistrar, StreamingRegistration } from './refreshRegistration';
import { containerLogsStreamManager } from './streaming/containerLogsStreamManager';
import { isSupportedDomain } from './streaming/resourceStreamDomains';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import type { RefreshDomain } from './types';

type OrchestratorRegistrationBuilder = (domain: RefreshDomain) => StreamingRegistration | undefined;

const resourceStreamRegistration: OrchestratorRegistrationBuilder = (domain) => {
  if (!isSupportedDomain(domain)) {
    throw new Error(`Missing resource-stream callback for refresh domain "${domain}".`);
  }
  return {
    start: async (scope) => {
      await resourceStreamManager.start(domain, scope);
      return undefined;
    },
    stop: (scope, options) => resourceStreamManager.stop(domain, scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce(domain, scope),
    pauseRefresherWhenStreaming: true,
  };
};

const containerLogsRegistration: OrchestratorRegistrationBuilder = (domain) => {
  if (domain !== 'container-logs') {
    throw new Error(`Missing container-logs callback for refresh domain "${domain}".`);
  }
  return {
    snapshotless: true,
    start: (scope) => {
      containerLogsStreamManager.startStream(scope);
      return Promise.resolve(undefined);
    },
    stop: (scope, options) => containerLogsStreamManager.stop(scope, options?.reset ?? false),
  };
};

// Executable callbacks stay hand-authored, while the generated policy decides
// which callback each domain receives. `satisfies` makes a new orchestrator
// kind fail typechecking until its callback is deliberately implemented.
const orchestratorRegistrationBuilders = {
  snapshot: () => undefined,
  'doorbell-snapshot': resourceStreamRegistration,
  'resource-stream': resourceStreamRegistration,
  'event-stream': resourceStreamRegistration,
  'catalog-stream': resourceStreamRegistration,
  'container-logs-stream': containerLogsRegistration,
} satisfies Record<RefreshOrchestratorKind, OrchestratorRegistrationBuilder>;

export function registerDefaultRefreshDomains(registrar: RefreshDomainRegistrar): void {
  for (const policy of frontendRefreshDomainPolicies) {
    const streaming = orchestratorRegistrationBuilders[policy.frontend.orchestrator](policy.domain);
    registrar.registerDomain({
      domain: policy.domain,
      refresherName: policy.frontend.refresherName,
      category: policy.category,
      ...(streaming ? { streaming } : {}),
      ...(policy.frontend.scheduled ? {} : { scheduled: false }),
    });
  }
}
