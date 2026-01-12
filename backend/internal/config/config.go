/*
 * backend/internal/config/config.go
 *
 * Configuration and timing settings used across the backend refresh subsystem.
 */

package config

import "time"

// Timing knobs used across the backend refresh subsystem.
const (
	// RefreshResyncInterval controls how often shared informers perform a full resync sweep.
	// This is the cadence we hand to Kubernetes SharedInformers for their built-in “full resync” sweep.
	// At that interval the informer re-lists the resource from the API to reconcile any missed events.
	// it’s a coarse, background safety-net.
	RefreshResyncInterval = 15 * time.Second

	// RefreshInformerSyncPollInterval is the poll frequency used while waiting for informer caches to sync.
	// This is purely local to our code. While we’re waiting for a set of informers to report HasSynced() == true,
	// we poll them on that short interval so the refresh snapshot builder can unblock as soon as their caches
	// are ready. Once they’re synced, the poller stops.
	RefreshInformerSyncPollInterval = 50 * time.Millisecond

	// RefreshMetricsInterval determines the cadence for the metrics poller (node/pod metrics).
	RefreshMetricsInterval = 5 * time.Second

	// RefreshRequestTimeout is the HTTP timeout used by refresh API clients.
	RefreshRequestTimeout = 30 * time.Second

	// SnapshotCacheTTL controls how long snapshot builds are cached to avoid redundant work.
	SnapshotCacheTTL = 5 * time.Second

	// ResponseCacheTTL controls how long non-informer resource GETs are cached.
	// Keep this short to reduce staleness while still cutting repeated requests.
	ResponseCacheTTL = 10 * time.Second

	// ResponseCacheMaxEntries caps the number of cached GET responses before eviction.
	ResponseCacheMaxEntries = 512

	// ResponseCacheInvalidationWarmupAge ignores cache invalidation events for very new objects.
	ResponseCacheInvalidationWarmupAge = time.Minute

	// PermissionCacheTTL controls how long SSAR permission decisions are cached.
	PermissionCacheTTL = 2 * time.Minute

	// PermissionCheckTimeout bounds SelfSubjectAccessReview calls.
	PermissionCheckTimeout = 5 * time.Second

	// PermissionPrimeTimeout bounds permission priming calls before informer registration.
	PermissionPrimeTimeout = 10 * time.Second

	// PermissionPreflightTimeout bounds permission preflight calls during refresh setup.
	PermissionPreflightTimeout = 15 * time.Second

	// ClusterVersionCacheTTL controls how long the cluster version lookup is cached.
	ClusterVersionCacheTTL = 10 * time.Minute

	// MetricsInitialBackoff defines the first retry delay when talking to the metrics API.
	MetricsInitialBackoff = 500 * time.Millisecond

	// MetricsMaxBackoff is the maximum backoff when polling metrics encounters repeated failures.
	MetricsMaxBackoff = 2 * time.Minute

	// MetricsStaleThreshold is the age after which cached metrics are considered stale.
	MetricsStaleThreshold = 45 * time.Second

	// MetricsStaleWindow is the window used to determine cluster overview metric freshness.
	MetricsStaleWindow = 45 * time.Second

	// LogStreamBackoffInitial is the initial backoff applied when log streaming reconnects.
	LogStreamBackoffInitial = 1 * time.Second

	// LogStreamBackoffMax is the cap for log stream reconnection backoff.
	LogStreamBackoffMax = 30 * time.Second

	// StreamHeartbeatInterval defines how often we evaluate heartbeat state for SSE streams.
	StreamHeartbeatInterval = 15 * time.Second

	// StreamHeartbeatTimeout is the max idle time before we flag the stream as stale.
	StreamHeartbeatTimeout = 45 * time.Second

	// LogStreamBatchWindow controls the bundling window for log stream events before flushing.
	LogStreamBatchWindow = 250 * time.Millisecond

	// LogStreamKeepAliveInterval controls how often keepalive messages are emitted for log streams.
	LogStreamKeepAliveInterval = 15 * time.Second

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

	// ResourceStreamMaxSubscribersPerScope limits concurrent resource stream subscribers per scope.
	ResourceStreamMaxSubscribersPerScope = 100

	// ResourceStreamSubscriberBufferSize buffers per-subscriber resource stream deliveries.
	ResourceStreamSubscriberBufferSize = 256

	// ResourceStreamResumeBufferSize caps buffered resource updates per scope for resume tokens.
	ResourceStreamResumeBufferSize = 1000

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

	// NodeDrainTimeout is the maximum time to wait for pods to terminate during node drain.
	NodeDrainTimeout = 30 * time.Second

	// NodeDrainRetryDelay is the sleep interval between checks while draining a node.
	NodeDrainRetryDelay = 2 * time.Second

	// NamespaceOperationTimeout is used when querying namespaces through the API.
	NamespaceOperationTimeout = 2 * time.Second

	// ManualJobMaxAttempts limits how many times we retry manual refresh operations.
	ManualJobMaxAttempts = 3

	// ManualJobRetryDelay is the base delay between manual refresh retries.
	ManualJobRetryDelay = 1 * time.Second
)
