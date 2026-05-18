import { getRefreshDomainDescriptor } from './domainRegistry';
import { catalogStreamManager } from './streaming/catalogStreamManager';
import { containerLogsStreamManager } from './streaming/containerLogsStreamManager';
import { eventStreamManager } from './streaming/eventStreamManager';
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

  const registerEventStreamDomain = (
    domain: 'cluster-events' | 'namespace-events',
    start: (scope: string) => Promise<(() => void) | void> | (() => void),
    stop: (scope: string, options?: { reset?: boolean }) => void,
    refreshOnce: (scope: string) => Promise<void>
  ) => {
    registerRefreshDomain(domain, {
      start,
      stop,
      refreshOnce,
      pauseRefresherWhenStreaming: true,
    });
  };

  const registerCatalogDomain = () => {
    registerRefreshDomain('catalog', {
      start: (scope) => catalogStreamManager.start(scope),
      stop: (_scope, options) => catalogStreamManager.stop(options?.reset ?? false),
      refreshOnce: (scope) => catalogStreamManager.refreshOnce(scope),
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
  resourceStreamDomain('pods', { metricsOnly: true });

  registerCatalogDomain();
  registerSnapshotDomains('catalog-diff');
  registerEventStreamDomain(
    'cluster-events',
    (scope) => eventStreamManager.startCluster(scope),
    (scope, options) => eventStreamManager.stopCluster(scope, options?.reset ?? false),
    (scope) => eventStreamManager.refreshCluster(scope)
  );
  resourceStreamDomain('nodes', { metricsOnly: true });
  resourceStreamDomain('cluster-rbac');
  resourceStreamDomain('cluster-storage');
  resourceStreamDomain('cluster-config');
  resourceStreamDomain('cluster-crds');
  resourceStreamDomain('cluster-custom');

  registerEventStreamDomain(
    'namespace-events',
    (scope) => eventStreamManager.startNamespace(scope),
    (scope, options) => eventStreamManager.stopNamespace(scope, options?.reset ?? false),
    (scope) => eventStreamManager.refreshNamespace(scope)
  );
  resourceStreamDomain('namespace-workloads', { metricsOnly: true });
  resourceStreamDomain('namespace-config');
  resourceStreamDomain('namespace-network');
  resourceStreamDomain('namespace-rbac');
  resourceStreamDomain('namespace-storage');
  resourceStreamDomain('namespace-autoscaling');
  resourceStreamDomain('namespace-quotas');
  resourceStreamDomain('namespace-custom');
  resourceStreamDomain('namespace-helm');
}
