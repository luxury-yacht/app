import { getRefreshDomainDescriptor } from './domainRegistry';
import { containerLogsStreamManager } from './streaming/containerLogsStreamManager';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import type { RefreshDomainRegistrar, StreamingRegistration } from './refreshRegistration';
import type { RefreshDomain } from './types';

// Helper for the common resource-stream domain pattern. Registry metadata
// supplies the category, refresher name, diagnostics stream, and timing.
type ResourceStreamDomainName = Parameters<typeof resourceStreamManager.start>[0];

export function registerDefaultRefreshDomains(registrar: RefreshDomainRegistrar): void {
  const registerRefreshDomain = (domain: RefreshDomain, streaming?: StreamingRegistration) => {
    const descriptor = getRefreshDomainDescriptor(domain);
    registrar.registerDomain({
      domain,
      refresherName: descriptor.refresherName,
      category: descriptor.category,
      ...(streaming ? { streaming } : {}),
    });
  };

  const resourceStreamDomain = (
    domain: RefreshDomain & ResourceStreamDomainName,
    options?: { metricsOnly?: boolean }
  ) => {
    registerRefreshDomain(domain, {
      start: (scope) => resourceStreamManager.start(domain, scope),
      stop: (scope, opts) => resourceStreamManager.stop(domain, scope, opts?.reset ?? false),
      refreshOnce: (scope) => resourceStreamManager.refreshOnce(domain, scope),
      metricsOnly: options?.metricsOnly,
      pauseRefresherWhenStreaming: !options?.metricsOnly,
    });
  };

  const doorbellStreamDomain = (domain: RefreshDomain & ResourceStreamDomainName) => {
    registerRefreshDomain(domain, {
      start: (scope) => resourceStreamManager.start(domain, scope),
      stop: (scope, options) => resourceStreamManager.stop(domain, scope, options?.reset ?? false),
      refreshOnce: (scope) => resourceStreamManager.refreshOnce(domain, scope),
      pauseRefresherWhenStreaming: true,
    });
  };

  const registerContainerLogsDomain = () => {
    registerRefreshDomain('container-logs', {
      start: (scope) => containerLogsStreamManager.startStream(scope),
      stop: (scope, options) => containerLogsStreamManager.stop(scope, options?.reset ?? false),
      refreshOnce: (scope) => containerLogsStreamManager.refreshOnce(scope),
    });
  };

  const registerSnapshotDomains = (...domains: RefreshDomain[]) => {
    domains.forEach((domain) => registerRefreshDomain(domain));
  };

  /*
    Preserve the existing frontend registration order.
    Metadata such as category, refresher name, timing, diagnostics stream, and
    priority lives in domainRegistry.ts so the refresh surfaces share one source.
  */
  registerSnapshotDomains(
    'namespaces',
    'cluster-overview',
    'object-maintenance',
    'object-details',
    'object-events',
    'object-map',
    'object-yaml',
    'object-helm-manifest',
    'object-helm-values'
  );
  registerContainerLogsDomain();
  resourceStreamDomain('pods');
  registerSnapshotDomains('pods-metrics');

  doorbellStreamDomain('catalog');
  registerSnapshotDomains('catalog-diff');
  doorbellStreamDomain('cluster-events');
  resourceStreamDomain('nodes');
  registerSnapshotDomains('nodes-metrics');
  resourceStreamDomain('cluster-rbac');
  resourceStreamDomain('cluster-storage');
  resourceStreamDomain('cluster-config');
  resourceStreamDomain('cluster-crds');
  resourceStreamDomain('cluster-custom');

  doorbellStreamDomain('namespace-events');
  resourceStreamDomain('namespace-workloads');
  registerSnapshotDomains('namespace-workloads-metrics');
  resourceStreamDomain('namespace-config');
  resourceStreamDomain('namespace-network');
  resourceStreamDomain('namespace-rbac');
  resourceStreamDomain('namespace-storage');
  resourceStreamDomain('namespace-autoscaling');
  resourceStreamDomain('namespace-quotas');
  resourceStreamDomain('namespace-custom');
  resourceStreamDomain('namespace-helm');
}
