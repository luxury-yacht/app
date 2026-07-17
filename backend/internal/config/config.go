/*
 * backend/internal/config/config.go
 *
 * Configuration and timing settings used across the backend.
 */

package config

import "time"

// Kubernetes REST client settings.
const (
	// KubernetesClientQPS controls the per-cluster client-go REST request rate.
	KubernetesClientQPS = 200

	// KubernetesClientBurst controls the per-cluster client-go REST burst allowance.
	KubernetesClientBurst = 500

	// KubernetesClientPreflightTimeout bounds the credential preflight check during client construction.
	// Must accommodate interactive exec credential plugins (e.g. kubectl-oidc_login/kubelogin) whose
	// browser-based authcode flow can take well over a minute on first login or token expiry. kubelogin's
	// own default authentication timeout is 180s, so we allow the same headroom here; otherwise the app
	// would abort the login before the user can complete SSO in the browser.
	KubernetesClientPreflightTimeout = 3 * time.Minute
)

// Refresh subsystem settings.
const (
	// RefreshResyncInterval controls how often shared informers perform a full resync sweep.
	// This is the cadence we hand to Kubernetes SharedInformers for their built-in "full resync" sweep.
	// At that interval the informer re-lists the resource from the API to reconcile any missed events.
	// It is a coarse, background safety-net.
	RefreshResyncInterval = 15 * time.Second

	// RefreshInformerSyncPollInterval is the poll frequency used while waiting for informer caches to sync.
	// This is purely local to our code. While we are waiting for a set of informers to report HasSynced() == true,
	// we poll them on that short interval so the refresh snapshot builder can unblock as soon as their caches
	// are ready. Once they are synced, the poller stops.
	RefreshInformerSyncPollInterval = 50 * time.Millisecond

	// RefreshInformerSyncTimeout bounds how long a snapshot build waits for informer caches
	// to sync. A single informer whose watch can never complete (for example an
	// RBAC-forbidden resource) would otherwise hang every snapshot for the cluster forever.
	RefreshInformerSyncTimeout = 30 * time.Second

	// RefreshInformerSyncDeadline bounds how long a single informer may take to reach
	// its initial sync after Start before it is marked DEGRADED and excluded from the
	// "all settled" readiness gate. A WatchList stream behind a bookmark-stripping proxy
	// never signals sync completion, so without this deadline one hung GVR would block
	// the whole cluster's readiness forever. A degraded informer is logged once and keeps
	// retrying in the background; it stops gating readiness so the rest of the cluster
	// becomes usable.
	RefreshInformerSyncDeadline = 15 * time.Second

	// RefreshMetricsInterval determines the cadence for the metrics poller (node/pod metrics).
	RefreshMetricsInterval = 5 * time.Second

	// RefreshRequestTimeout is the HTTP timeout used by refresh API clients.
	RefreshRequestTimeout = 30 * time.Second
)

// Snapshot and response cache settings.
const (
	// SnapshotCacheTTL controls how long snapshot builds are cached to avoid redundant work.
	SnapshotCacheTTL = 5 * time.Second

	// ResponseCacheTTL controls how long non-informer resource GETs are cached.
	// Keep this short to reduce staleness while still cutting repeated requests.
	ResponseCacheTTL = 10 * time.Second

	// ResponseCacheMaxEntries caps the number of cached GET responses before eviction.
	ResponseCacheMaxEntries = 512

	// ResponseCacheInvalidationWarmupAge ignores cache invalidation events for very new objects.
	ResponseCacheInvalidationWarmupAge = time.Minute

	// SnapshotClusterEventsLimit caps cluster event summaries in refresh snapshots.
	SnapshotClusterEventsLimit = 500

	// SnapshotNamespaceEventsLimit caps namespace event summaries in refresh snapshots.
	SnapshotNamespaceEventsLimit = 500

	// SnapshotObjectEventsLimit caps object event summaries in refresh snapshots.
	SnapshotObjectEventsLimit = 500

	// SnapshotClusterNodesEntryLimit caps cluster node snapshot rows before the table becomes partial.
	SnapshotClusterNodesEntryLimit = 1000

	// SnapshotClusterConfigEntryLimit caps cluster configuration snapshot rows.
	SnapshotClusterConfigEntryLimit = 1000

	// SnapshotClusterStorageEntryLimit caps cluster storage snapshot rows.
	SnapshotClusterStorageEntryLimit = 1000

	// SnapshotClusterRBACEntryLimit caps cluster RBAC snapshot rows.
	SnapshotClusterRBACEntryLimit = 1000

	// SnapshotClusterCRDEntryLimit caps cluster CRD snapshot rows.
	SnapshotClusterCRDEntryLimit = 1000

	// SnapshotClusterAttentionEntryLimit caps cluster attention snapshot rows.
	SnapshotClusterAttentionEntryLimit = 1000

	// SnapshotClusterOverviewRecentEventsLimit caps recent warning events in cluster overview snapshots.
	SnapshotClusterOverviewRecentEventsLimit = 20

	// SnapshotClusterOverviewRecentEventsLookback is the lookback window for cluster overview warning events.
	SnapshotClusterOverviewRecentEventsLookback = 24 * time.Hour

	// SnapshotNamespaceWorkloadsEntryLimit caps namespace workload snapshot rows.
	SnapshotNamespaceWorkloadsEntryLimit = 1000

	// SnapshotNamespacePodsEntryLimit caps namespace pod snapshot rows before the
	// non-query window becomes partial.
	SnapshotNamespacePodsEntryLimit = 1000

	// SnapshotNamespaceConfigEntryLimit caps namespace config snapshot rows.
	SnapshotNamespaceConfigEntryLimit = 1000

	// SnapshotNamespaceAutoscalingEntryLimit caps namespace autoscaling snapshot rows.
	SnapshotNamespaceAutoscalingEntryLimit = 1000

	// SnapshotNamespaceNetworkEntryLimit caps namespace network snapshot rows.
	SnapshotNamespaceNetworkEntryLimit = 1000

	// SnapshotNamespaceStorageEntryLimit caps namespace storage snapshot rows.
	SnapshotNamespaceStorageEntryLimit = 1000

	// SnapshotNamespaceQuotasEntryLimit caps namespace quota snapshot rows.
	SnapshotNamespaceQuotasEntryLimit = 1000

	// SnapshotNamespaceHelmEntryLimit caps all-namespaces Helm snapshot rows.
	SnapshotNamespaceHelmEntryLimit = 1000

	// SnapshotNamespaceRBACEntryLimit caps all-namespaces namespace RBAC snapshot rows.
	SnapshotNamespaceRBACEntryLimit = 1000

	// SnapshotNamespaceCustomWorkerLimit caps namespace custom-resource list fanout.
	SnapshotNamespaceCustomWorkerLimit = 8

	// SnapshotClusterCustomWorkerLimit caps cluster custom-resource list fanout.
	SnapshotClusterCustomWorkerLimit = 8

	// SnapshotNamespaceHelmWorkerLimit caps namespace Helm snapshot fanout.
	SnapshotNamespaceHelmWorkerLimit = 8
)

// Permission and authorization review settings.
const (
	// PermissionCacheTTL controls how long SSAR permission decisions are cached.
	PermissionCacheTTL = 2 * time.Minute

	// PermissionCacheStaleGracePeriod is the extra window beyond TTL during which
	// a stale cached permission decision can be returned immediately while a
	// background refresh is triggered. Beyond TTL + grace, the caller blocks.
	PermissionCacheStaleGracePeriod = 30 * time.Second

	// PermissionCheckTimeout bounds SelfSubjectAccessReview calls.
	PermissionCheckTimeout = 5 * time.Second

	// SSRRFetchTimeout bounds SelfSubjectRulesReview calls.
	SSRRFetchTimeout = 5 * time.Second

	// PermissionReviewRetryMaxAttempts caps retries for Kubernetes authorization review calls.
	PermissionReviewRetryMaxAttempts = 3

	// PermissionReviewRetryInitialBackoff is the first delay before retrying a throttled/transient authorization review.
	PermissionReviewRetryInitialBackoff = 100 * time.Millisecond

	// PermissionReviewRetryMaxBackoff caps retry delays for authorization reviews.
	PermissionReviewRetryMaxBackoff = time.Second

	// PermissionPrimeTimeout bounds permission priming calls before informer registration.
	PermissionPrimeTimeout = 10 * time.Second

	// PermissionPreflightTimeout bounds permission preflight calls during refresh setup.
	PermissionPreflightTimeout = 15 * time.Second

	// PermissionSSRRFetchConcurrency caps concurrent namespace SelfSubjectRulesReview fetches.
	PermissionSSRRFetchConcurrency = 32

	// AuthorizationReviewWorkerCount controls concurrent SelfSubjectAccessReview workers.
	AuthorizationReviewWorkerCount = 32

	// AuthorizationReviewRequestsPerSecond limits SSAR submission rate; zero means unlimited.
	AuthorizationReviewRequestsPerSecond = 0

	// AuthorizationReviewSlowThreshold controls when SSAR calls are logged as slow.
	AuthorizationReviewSlowThreshold = 750 * time.Millisecond
)

// Cluster metadata and health settings.
const (
	// ClusterVersionCacheTTL controls how long the cluster version lookup is cached.
	ClusterVersionCacheTTL = 10 * time.Minute

	// ClusterHealthHeartbeatInterval is how often we check each cluster's health via /readyz.
	ClusterHealthHeartbeatInterval = 5 * time.Second

	// ClusterHealthHeartbeatTimeout bounds a single /readyz heartbeat request.
	ClusterHealthHeartbeatTimeout = 5 * time.Second

	// ClusterTransportFailureThreshold is the number of failures before auth recovery can rebuild transport.
	ClusterTransportFailureThreshold = 3

	// ClusterTransportFailureWindow is the rolling window for transport failure counting.
	ClusterTransportFailureWindow = 30 * time.Second

	// ClusterTransportRebuildCooldown is the minimum gap between transport rebuild attempts.
	ClusterTransportRebuildCooldown = time.Minute

	// ClusterLifecycleSlowLoadingThreshold controls when cluster loading is reported as slow.
	ClusterLifecycleSlowLoadingThreshold = 10 * time.Second

	// ClusterOperationTimeout bounds coordinated per-cluster operations.
	ClusterOperationTimeout = 90 * time.Second
)

// Resource governor settings. The governor bounds RAM when many clusters are
// open by keeping only the visible cluster plus a small warm set running fully
// and tearing the rest down.
const (
	// GovernorKeepWarm is the default number of non-visible clusters kept warm
	// (Background) when not under memory pressure. Beyond it, clusters go Cold.
	GovernorKeepWarm = 2

	// GovernorHeapBudgetBytes is the default HeapInuse budget. When the process
	// exceeds it, the warm set collapses to 0 so non-visible clusters are torn
	// down to reclaim heap. A value of 0 disables pressure-driven demotion.
	GovernorHeapBudgetBytes = 1 << 30 // 1 GiB

	// GovernorPressureInterval is how often the governor samples heap usage to
	// update its memory-pressure signal.
	GovernorPressureInterval = 10 * time.Second
)

// Metrics collection settings.
const (
	// MetricsInitialBackoff defines the first retry delay when talking to the metrics API.
	MetricsInitialBackoff = 500 * time.Millisecond

	// MetricsMaxBackoff is the maximum backoff when polling metrics encounters repeated failures.
	MetricsMaxBackoff = 2 * time.Minute

	// MetricsStaleThreshold is the age after which cached metrics are considered stale.
	MetricsStaleThreshold = 45 * time.Second

	// MetricsStaleWindow is the window used to determine cluster overview metric freshness.
	MetricsStaleWindow = 45 * time.Second
)

// Container log stream settings.
const (
	// ContainerLogsStreamBackoffInitial is the initial backoff applied when container logs streaming reconnects.
	ContainerLogsStreamBackoffInitial = 1 * time.Second

	// ContainerLogsStreamBackoffMax is the cap for container logs stream reconnection backoff.
	ContainerLogsStreamBackoffMax = 30 * time.Second

	// StreamHeartbeatInterval defines how often we evaluate heartbeat state for SSE streams.
	StreamHeartbeatInterval = 15 * time.Second

	// StreamHeartbeatTimeout is the max idle time before we flag the stream as stale.
	StreamHeartbeatTimeout = 45 * time.Second

	// ContainerLogsStreamBatchWindow controls the bundling window for container logs stream events before flushing.
	ContainerLogsStreamBatchWindow = 250 * time.Millisecond

	// ContainerLogsStreamKeepAliveInterval controls how often keepalive messages are emitted for container logs streams.
	ContainerLogsStreamKeepAliveInterval = 15 * time.Second

	// ContainerLogsStreamGlobalTargetLimit caps resolved pod/container targets across all active log scopes.
	ContainerLogsStreamGlobalTargetLimit = 200

	// ContainerLogsStreamDefaultTailLines is the default starting tail for log streams.
	ContainerLogsStreamDefaultTailLines = 1000

	// ContainerLogsStreamMaxTailLines caps requested log stream tail lines.
	ContainerLogsStreamMaxTailLines = 10000

	// ContainerLogsStreamBatchMaxSize caps log entries emitted in one SSE batch.
	ContainerLogsStreamBatchMaxSize = 64

	// ContainerLogsStreamCronCacheMaxSize caps cached cron job owner lookups.
	ContainerLogsStreamCronCacheMaxSize = 1000
)

// Event stream settings.
const (
	// EventStreamKeepAliveInterval controls how often keepalive messages are emitted for event streams.
	EventStreamKeepAliveInterval = 15 * time.Second

	// EventStreamMaxSubscribersPerScope limits concurrent subscribers per scope to prevent memory exhaustion.
	EventStreamMaxSubscribersPerScope = 100

	// EventStreamResumeBufferSize caps stored events per scope for resume tokens.
	EventStreamResumeBufferSize = 1000

	// EventStreamSubscriberBufferSize buffers per-subscriber event stream deliveries.
	EventStreamSubscriberBufferSize = 256

	// AggregateEventStreamResumeBufferSize caps stored aggregate events per scope for resume tokens.
	AggregateEventStreamResumeBufferSize = 2000

	// AggregateEventStreamEntryBufferSize buffers aggregate events before delivery.
	AggregateEventStreamEntryBufferSize = 256
)

// Resource stream settings.
const (
	// ResourceStreamMaxSubscribersPerScope limits concurrent resource stream subscribers per scope.
	ResourceStreamMaxSubscribersPerScope = 100

	// ResourceStreamSubscriberBufferSize buffers per-subscriber resource stream deliveries.
	ResourceStreamSubscriberBufferSize = 256

	// ResourceStreamResumeBufferSize caps buffered resource updates per scope for resume tokens.
	ResourceStreamResumeBufferSize = 1000
)

// Stream mux websocket settings.
const (
	// StreamMuxWriteTimeout bounds websocket writes for multiplexed streams.
	StreamMuxWriteTimeout = 10 * time.Second

	// StreamMuxHandshakeTimeout bounds websocket upgrade handshakes for multiplexed streams.
	StreamMuxHandshakeTimeout = 45 * time.Second

	// StreamMuxOutgoingBufferSize caps queued outbound messages per multiplexed stream.
	StreamMuxOutgoingBufferSize = 512

	// StreamMuxReadBufferSize configures websocket read buffer sizing for multiplexed streams.
	StreamMuxReadBufferSize = 4096

	// StreamMuxWriteBufferSize configures websocket write buffer sizing for multiplexed streams.
	StreamMuxWriteBufferSize = 4096
)

// Node maintenance settings.
const (
	// NodeDrainRetryDelay is the sleep interval between checks while draining a node.
	NodeDrainRetryDelay = 2 * time.Second
)

// Namespace operation settings.
const (
	// NamespaceOperationTimeout is used when querying namespaces through the API.
	NamespaceOperationTimeout = 2 * time.Second
)

// Resource fetch settings.
const (
	// ResourceFetchMaxAttempts caps retry attempts for direct resource fetches.
	ResourceFetchMaxAttempts = 3

	// ResourceFetchRetryBaseDelay is the first retry delay for direct resource fetches.
	ResourceFetchRetryBaseDelay = 250 * time.Millisecond

	// ResourceFetchRetryMaxDelay caps retry delays for direct resource fetches.
	ResourceFetchRetryMaxDelay = 2 * time.Second

	// ResourceFetchCallTimeout bounds direct resource fetch calls that do not already have a deadline.
	ResourceFetchCallTimeout = 30 * time.Second
)

// Object catalog settings.
const (
	// ObjectCatalogResyncInterval controls periodic full catalog syncs.
	ObjectCatalogResyncInterval = 1 * time.Minute

	// ObjectCatalogFailedSyncRetryInterval is the short interval the catalog retries
	// on after a failed/incomplete sync (typically the startup race where ingest
	// stores are not yet synced), backing off toward the normal resync interval so a
	// transient failure self-heals promptly instead of leaving the catalog degraded
	// until the next full resync (up to 5 min with reactive updates enabled).
	ObjectCatalogFailedSyncRetryInterval = 3 * time.Second

	// ObjectCatalogPageSize controls page size for Kubernetes list calls.
	ObjectCatalogPageSize = 50

	// ObjectCatalogListWorkers controls baseline concurrent resource listing workers.
	ObjectCatalogListWorkers = 32

	// ObjectCatalogNamespaceWorkers controls concurrent namespace-scoped catalog work.
	ObjectCatalogNamespaceWorkers = 16

	// ObjectCatalogEvictionTTL controls how long missing catalog entries are retained.
	ObjectCatalogEvictionTTL = 10 * time.Minute

	// ObjectCatalogInformerPromotionThreshold controls when resources are promoted to informer-backed updates.
	ObjectCatalogInformerPromotionThreshold = 5000

	// ObjectCatalogStreamingBatchSize controls catalog streaming batch size.
	ObjectCatalogStreamingBatchSize = 100

	// ObjectCatalogStreamingFlushInterval controls catalog streaming flush cadence.
	ObjectCatalogStreamingFlushInterval = 500 * time.Millisecond

	// ObjectCatalogQueryLimit is the default maximum rows returned by catalog queries.
	ObjectCatalogQueryLimit = 1000

	// ObjectCatalogMaxQueryLimit caps caller-supplied catalog query limits.
	ObjectCatalogMaxQueryLimit = 10000

	// ObjectCatalogListRetryMaxAttempts caps retries for catalog list calls.
	ObjectCatalogListRetryMaxAttempts = 3

	// ObjectCatalogListRetryInitialBackoff is the first retry delay for catalog list calls.
	ObjectCatalogListRetryInitialBackoff = 200 * time.Millisecond

	// ObjectCatalogListRetryMaxBackoff caps retry delays for catalog list calls.
	ObjectCatalogListRetryMaxBackoff = 2 * time.Second

	// ObjectCatalogDiscoveryRequestTimeout bounds catalog discovery requests.
	ObjectCatalogDiscoveryRequestTimeout = 15 * time.Second

	// ObjectCatalogDiscoveryCacheTTL bounds how long the catalog's disk-cached discovery
	// document is reused without revalidation. A CRD add/delete invalidates the cache
	// immediately (see Service.markDiscoveryStale), so this only bounds the worst-case
	// staleness for changes the catalog's CRD watch does not observe (e.g. a new API group
	// from an aggregated-apiserver install), not for CRDs.
	ObjectCatalogDiscoveryCacheTTL = 10 * time.Minute

	// ObjectCatalogWatchPendingBufferSize caps pending informer watch events.
	ObjectCatalogWatchPendingBufferSize = 8192

	// ObjectCatalogWatchDebounceInterval coalesces informer watch flushes.
	ObjectCatalogWatchDebounceInterval = 200 * time.Millisecond

	// ObjectCatalogWatchOverflowWarnInterval throttles notifier overflow warnings per cluster.
	ObjectCatalogWatchOverflowWarnInterval = 30 * time.Second

	// ObjectCatalogReactiveMinResyncInterval is the minimum full resync interval when reactive updates are enabled.
	ObjectCatalogReactiveMinResyncInterval = 5 * time.Minute
)

// Kubeconfig settings.
const (
	// KubeconfigSelectionChangeWorkTimeout bounds async work after changing cluster selection.
	KubeconfigSelectionChangeWorkTimeout = 2 * time.Minute

	// KubeconfigWatcherDebounceInterval coalesces kubeconfig filesystem events.
	KubeconfigWatcherDebounceInterval = 500 * time.Millisecond
)

// Port forward settings.
const (
	// PortForwardMaxReconnectAttempts caps automatic reconnect attempts.
	PortForwardMaxReconnectAttempts = 5

	// PortForwardInitialBackoff is the first delay before reconnecting a port forward.
	PortForwardInitialBackoff = time.Second

	// PortForwardMaxBackoff caps port forward reconnect delays.
	PortForwardMaxBackoff = 30 * time.Second

	// PortForwardResolveTimeout bounds target-to-pod resolution.
	PortForwardResolveTimeout = 30 * time.Second

	// PortForwardConnectTimeout bounds the initial port forward connection wait.
	PortForwardConnectTimeout = 30 * time.Second

	// PortForwardTargetPortsTimeout bounds target port lookup.
	PortForwardTargetPortsTimeout = 10 * time.Second
)

// Kubernetes resource operation settings.
const (
	// ObjectYAMLMutationRequestTimeout bounds YAML edit/delete operations.
	ObjectYAMLMutationRequestTimeout = 15 * time.Second

	// KindOnlyDiscoveryTimeout bounds kind-only discovery walks.
	KindOnlyDiscoveryTimeout = 10 * time.Second

	// GVKResolveTimeout bounds discovery used to resolve a GroupVersionKind.
	GVKResolveTimeout = 15 * time.Second

	// EndpointSliceLookupTimeout bounds EndpointSlice lookups while building Service details.
	EndpointSliceLookupTimeout = 10 * time.Second

	// DebugContainerPollInterval controls how often debug container status is polled.
	DebugContainerPollInterval = 500 * time.Millisecond

	// DebugContainerPollTimeout controls how long to wait for a debug container to start.
	DebugContainerPollTimeout = 30 * time.Second
)

// Application update settings.
const (
	// AppUpdateRequestTimeout bounds update metadata checks.
	AppUpdateRequestTimeout = 6 * time.Second
)

// Application menu settings.
const (
	// AppMenuTriggerMaxRetries caps retries while waiting for Wails context before emitting menu events.
	AppMenuTriggerMaxRetries = 3

	// AppMenuTriggerRetryDelay is the delay between menu event retry attempts.
	AppMenuTriggerRetryDelay = 100 * time.Millisecond
)

// Authentication environment settings.
const (
	// AuthEnvironmentSetupTimeout bounds login shell PATH discovery.
	AuthEnvironmentSetupTimeout = 500 * time.Millisecond

	// ClusterAuthRecoveryMaxAttempts is the default number of auth recovery attempts.
	ClusterAuthRecoveryMaxAttempts = 4

	// AuthRecoveryProgressInterval controls countdown progress emission during auth recovery backoff.
	AuthRecoveryProgressInterval = time.Second

	// ClusterAuthConnectivityRetryInterval is the delay between recovery probes
	// while a cluster is unreachable. Connectivity failures do not consume
	// recovery attempts, so this paces the open-ended reconnect loop.
	ClusterAuthConnectivityRetryInterval = 15 * time.Second

	// ClusterAuthRecoveryProbeTimeout bounds a single auth recovery probe request.
	// Sized to match the preflight timeout so an interactive exec credential plugin
	// (e.g. kubectl-oidc_login/kubelogin) has time to complete its browser-based login
	// during recovery instead of being killed mid-flow.
	ClusterAuthRecoveryProbeTimeout = 3 * time.Minute

	// ClusterAuthSteadyRetryInterval is the delay between recovery probes after
	// the auth verdict has settled to invalid. The recovery loop never stops,
	// so externally fixed credentials (e.g. a fresh SSO login) are noticed
	// without user action.
	ClusterAuthSteadyRetryInterval = time.Minute
)

// ClusterAuthRecoveryBackoffSchedule is the default delay schedule between auth recovery attempts.
var ClusterAuthRecoveryBackoffSchedule = []time.Duration{0, 5 * time.Second, 10 * time.Second, 15 * time.Second}

// Shell session settings.
const (
	// ShellSessionIdleTimeout is the inactivity window before a shell session is terminated.
	ShellSessionIdleTimeout = 30 * time.Minute

	// ShellSessionMaxDuration is the maximum lifetime of a shell session.
	ShellSessionMaxDuration = 8 * time.Hour

	// ShellSessionShutdownTimeout bounds shell process shutdown.
	ShellSessionShutdownTimeout = 30 * time.Second

	// ShellSessionCleanupInterval controls how often shell sessions are checked for expiry.
	ShellSessionCleanupInterval = time.Minute
)

// Shutdown settings.
const (
	// RefreshShutdownTimeout bounds refresh manager and refresh HTTP server shutdown.
	RefreshShutdownTimeout = time.Second
)

// Manual refresh job settings.
const (
	// ManualJobMaxAttempts limits how many times we retry manual refresh operations.
	ManualJobMaxAttempts = 3

	// ManualJobRetryDelay is the base delay between manual refresh retries.
	ManualJobRetryDelay = 1 * time.Second
)
