import { getRefreshDomainDescriptor } from './domainRegistry';
import type { RefreshDomainRegistrar, StreamingRegistration } from './refreshRegistration';
import { containerLogsStreamManager } from './streaming/containerLogsStreamManager';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import type { RefreshDomain } from './types';

// Helper for the common resource-stream domain pattern. Registry metadata
// supplies the category, refresher name, diagnostics stream, and timing.
type ResourceStreamDomainName = Parameters<typeof resourceStreamManager.start>[0];

export function registerDefaultRefreshDomains(registrar: RefreshDomainRegistrar): void {
  const registerRefreshDomain = (
    domain: RefreshDomain,
    streaming?: StreamingRegistration,
    scheduled = true
  ) => {
    const descriptor = getRefreshDomainDescriptor(domain);
    registrar.registerDomain({
      domain,
      refresherName: descriptor.refresherName,
      category: descriptor.category,
      ...(streaming ? { streaming } : {}),
      ...(scheduled ? {} : { scheduled: false }),
    });
  };

  const resourceStreamDomain = (domain: RefreshDomain & ResourceStreamDomainName) => {
    registerRefreshDomain(domain, {
      start: async (scope) => {
        await resourceStreamManager.start(domain, scope);
        return undefined;
      },
      stop: (scope, opts) => resourceStreamManager.stop(domain, scope, opts?.reset ?? false),
      refreshOnce: (scope) => resourceStreamManager.refreshOnce(domain, scope),
      pauseRefresherWhenStreaming: true,
    });
  };

  // Doorbell domains (catalog/events) share the exact stream wiring; the alias
  // keeps the domain-class distinction readable at the registration sites.
  const doorbellStreamDomain = resourceStreamDomain;

  const registerContainerLogsDomain = () => {
    registerRefreshDomain('container-logs', {
      snapshotless: true,
      start: async (scope) => {
        await containerLogsStreamManager.startStream(scope);
        return undefined;
      },
      stop: (scope, options) => containerLogsStreamManager.stop(scope, options?.reset ?? false),
      refreshOnce: (scope) => containerLogsStreamManager.refreshOnce(scope),
    });
  };

  const registerSnapshotDomains = (...domains: RefreshDomain[]) => {
    domains.forEach((domain) => {
      registerRefreshDomain(domain);
    });
  };

  /*
    Preserve the existing frontend registration order.
    Metadata such as category, refresher name, timing, diagnostics stream, and
    priority lives in domainRegistry.ts so the refresh surfaces share one source.
  */
  // The namespaces sidebar refetches on the backend's namespaces doorbell
  // (namespace object changes + workload-presence flips); its 2s timing is now
  // only the stream-down fallback.
  doorbellStreamDomain('namespaces');
  // Namespace utilization has an independent metric clock and payload. Only
  // visible namespace surfaces lease it, so open background tabs do not turn
  // the shared Kubernetes metrics poller on.
  doorbellStreamDomain('namespace-metrics');
  // The Object Panel Events tab refetches on the backend's per-object events
  // doorbell; its 10s timing is now only the stream-down fallback.
  doorbellStreamDomain('object-events');
  // The overview's metric doorbell refetches on each successful collection;
  // its polls STAY ON via the descriptor's pollingContinuesWhileStreaming
  // (the doorbell may never ring on metrics-less clusters).
  doorbellStreamDomain('cluster-overview');
  doorbellStreamDomain('cluster-attention');
  registerSnapshotDomains('object-maintenance');
  // Each open panel owns a distinct 2s/5s object-details refresher; registering
  // the shared 10s refresher as well would schedule every scope twice.
  registerRefreshDomain('object-details', undefined, false);
  registerSnapshotDomains(
    'object-map',
    'object-yaml',
    'object-helm-manifest',
    'object-helm-values'
  );
  registerContainerLogsDomain();
  // pods/nodes/namespace-workloads join live usage at serve; their metric cadence
  // is push-driven — the backend poller fans a metric doorbell over the stream
  // after each collection, so no client-side polling is needed for it.
  resourceStreamDomain('pods');

  doorbellStreamDomain('catalog');
  registerSnapshotDomains('catalog-diff');
  doorbellStreamDomain('cluster-events');
  resourceStreamDomain('nodes');
  resourceStreamDomain('cluster-rbac');
  resourceStreamDomain('cluster-storage');
  resourceStreamDomain('cluster-config');
  resourceStreamDomain('cluster-crds');
  resourceStreamDomain('cluster-custom');

  doorbellStreamDomain('namespace-events');
  resourceStreamDomain('namespace-workloads');
  resourceStreamDomain('namespace-config');
  resourceStreamDomain('namespace-network');
  resourceStreamDomain('namespace-rbac');
  resourceStreamDomain('namespace-storage');
  resourceStreamDomain('namespace-autoscaling');
  resourceStreamDomain('namespace-quotas');
  resourceStreamDomain('namespace-custom');
  resourceStreamDomain('namespace-helm');
}
