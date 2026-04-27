/*
 * backend/internal/config/config.go
 *
 * Configuration and timing settings used across the backend refresh subsystem.
 */

package config

import "time"

// Kubernetes REST client settings.
const (
	// KubernetesClientQPS controls the per-cluster client-go REST request rate.
	KubernetesClientQPS = 500

	// KubernetesClientBurst controls the per-cluster client-go REST burst allowance.
	KubernetesClientBurst = 1000
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
)

// Cluster metadata and health settings.
const (
	// ClusterVersionCacheTTL controls how long the cluster version lookup is cached.
	ClusterVersionCacheTTL = 10 * time.Minute

	// ClusterHealthHeartbeatInterval is how often we check each cluster's health via /readyz.
	ClusterHealthHeartbeatInterval = 5 * time.Second
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
	// NodeDrainTimeout is the maximum time to wait for pods to terminate during node drain.
	NodeDrainTimeout = 30 * time.Second

	// NodeDrainRetryDelay is the sleep interval between checks while draining a node.
	NodeDrainRetryDelay = 2 * time.Second
)

// Namespace operation settings.
const (
	// NamespaceOperationTimeout is used when querying namespaces through the API.
	NamespaceOperationTimeout = 2 * time.Second
)

// Manual refresh job settings.
const (
	// ManualJobMaxAttempts limits how many times we retry manual refresh operations.
	ManualJobMaxAttempts = 3

	// ManualJobRetryDelay is the base delay between manual refresh retries.
	ManualJobRetryDelay = 1 * time.Second
)
