/*
 * backend/refresh/resourcestream/manager.go
 *
 * The cluster generation's doorbell and named-stream hub. Producers ring it
 * after their stores apply a change (docs/architecture/data-freshness.md,
 * "Signals and source clocks"); subscription fan-out lives in stream_hub.go.
 */

package resourcestream

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/ringbuffer"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	domainPods                 = "pods"
	domainWorkloads            = "namespace-workloads"
	domainNamespaceConfig      = "namespace-config"
	domainNamespaceNetwork     = "namespace-network"
	domainNamespaceRBAC        = "namespace-rbac"
	domainNamespaceHelm        = "namespace-helm"
	domainNamespaceAutoscaling = "namespace-autoscaling"
	domainNamespaceQuotas      = "namespace-quotas"
	domainNamespaceStorage     = "namespace-storage"
	// Cluster-scoped domains stream resources without namespace scopes.
	domainClusterRBAC     = "cluster-rbac"
	domainClusterStorage  = "cluster-storage"
	domainClusterConfig   = "cluster-config"
	domainClusterCRDs     = "cluster-crds"
	domainNodes           = "nodes"
	domainCatalog         = "catalog"
	domainClusterEvents   = "cluster-events"
	domainNamespaceEvents = "namespace-events"
	// domainNamespaces is the namespace-list doorbell domain: signal-only, no
	// projected rows — namespace object changes and workload-presence flips
	// tell the frontend to refetch the namespaces snapshot.
	domainNamespaces = "namespaces"
	// domainNamespaceMetrics is the namespace-list metric doorbell domain:
	// signal-only, no projected rows. A successful metrics collection tells a
	// visible namespace surface to refetch its metric-only snapshot.
	domainNamespaceMetrics = "namespace-metrics"
	// domainObjectEvents is the per-object events doorbell domain: signal-only,
	// no projected rows — an event for a panel's object tells the frontend to
	// refetch that object's events snapshot.
	domainObjectEvents = "object-events"
	// domainObjectDetails is the per-object details doorbell domain:
	// signal-only, no projected rows — rung after Refresh evicts an object's
	// cached details, so an open panel refetches them. Its polls stay on as the
	// backstop for kinds no eviction covers.
	domainObjectDetails = "object-details"
	// domainClusterOverview is the overview's metric doorbell domain:
	// signal-only, no projected rows — a successful metrics collection tells
	// the frontend to refetch the overview snapshot so live usage appears
	// within one collection instead of a full poll cycle. Unlike the other
	// doorbell domains its POLLS STAY ON: the doorbell only rings on
	// successful collections, so a metrics-less cluster would otherwise
	// freeze the overview's object-derived counts.
	domainClusterOverview   = "cluster-overview"
	domainClusterAttention  = "cluster-attention"
	domainClusterIdentities = "cluster-identities"
)

type subscription struct {
	ch         chan Update
	drops      chan DropReason
	created    time.Time
	deliveryMu sync.Mutex
	closed     bool
	// resyncing is set when backpressure triggers a RESET for this subscriber.
	resyncing uint32
}

// bufferedUpdate tags an update with a sequence for resume tokens.
type bufferedUpdate struct {
	sequence uint64
	update   Update
}

// updateBuffer is the per-domain/scope resume buffer; the ring + replay logic is
// shared via ringbuffer.Buffer.
type updateBuffer = ringbuffer.Buffer[bufferedUpdate]

// newUpdateBuffer allocates a resume buffer capped at the requested size.
func newUpdateBuffer(capacity int) *updateBuffer {
	return ringbuffer.New(capacity, func(u bufferedUpdate) uint64 { return u.sequence })
}

func (s *subscription) close(reason DropReason) {
	if s == nil {
		return
	}
	s.deliveryMu.Lock()
	defer s.deliveryMu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	if reason != "" {
		select {
		case s.drops <- reason:
		default:
		}
	}
	close(s.drops)
	close(s.ch)
}

func (s *subscription) isResyncing() bool {
	return s != nil && atomic.LoadUint32(&s.resyncing) == 1
}

func (s *subscription) markResyncing() bool {
	if s == nil {
		return false
	}
	return atomic.CompareAndSwapUint32(&s.resyncing, 0, 1)
}

// Manager fans out feed updates to named-stream subscribers.
type Manager struct {
	clusterMeta snapshot.ClusterMeta
	logger      containerlogsstream.Logger
	telemetry   *telemetry.Recorder
	permissions permissions.ListWatchChecker

	podIngest podBundleRewriter

	// Stop is terminal for this generation and rejects new subscriptions.
	stopped atomic.Bool
	// generation joins every ring and producer callback; Stop waits for the
	// running ones before subscriptions close.
	generation doorbell.Generation
	// snapshotDomainInvalidator evicts query snapshots before a change signal is
	// delivered. A healthy stream suppresses polling, so serving the pre-change
	// snapshot from cache after this one-shot signal would leave the query stale.
	snapshotDomainInvalidator func(domain string)

	mu          sync.RWMutex
	subscribers map[string]map[string]map[uint64]*subscription
	nextID      uint64
	buffers     map[string]*updateBuffer
	sequences   map[string]uint64

	jobPodOwnerHealSink        *ingest.AsyncBundleSink
	replicaSetPodOwnerHealSink *ingest.AsyncBundleSink
}

// NewManager returns a cluster generation's resource stream: the doorbell every
// producer rings and the hub the named stream subscribes to. invalidator evicts
// a domain's cached snapshots; every ring calls it first. It is complete when
// it returns, so producers can receive it at construction.
func NewManager(
	logger containerlogsstream.Logger,
	recorder *telemetry.Recorder,
	meta snapshot.ClusterMeta,
	invalidator func(domain string),
) *Manager {
	if logger == nil {
		logger = applog.Noop
	}
	return &Manager{
		clusterMeta:               meta,
		logger:                    logger,
		telemetry:                 recorder,
		snapshotDomainInvalidator: invalidator,
		subscribers:               make(map[string]map[string]map[uint64]*subscription),
		buffers:                   make(map[string]*updateBuffer),
		sequences:                 make(map[string]uint64),
	}
}

// RegisterSources attaches the stream's owner heals to the cluster's sources.
// It runs during subsystem construction, after the permission preflight has
// primed the checks it makes and before the sources start. Table changes ring
// from their own stores, not from here.
func (m *Manager) RegisterSources(permissionChecker permissions.ListWatchChecker, ingestManager *ingest.IngestManager) {
	if m == nil || permissionChecker == nil {
		return
	}
	m.permissions = permissionChecker
	if ingestManager != nil {
		m.podIngest = ingestManager
	}
	m.registerOwnerHeals(ingestManager)
}

// Stop ends the generation: it rejects new rings and producer callbacks, waits
// for the running ones, then closes subscriptions and owned delivery workers.
// It is terminal and must not be called from a ring or producer callback.
func (m *Manager) Stop() {
	if m == nil {
		return
	}
	m.generation.Stop()
	for _, sink := range []*ingest.AsyncBundleSink{m.jobPodOwnerHealSink, m.replicaSetPodOwnerHealSink} {
		if sink != nil {
			sink.Stop()
		}
	}
	m.stopped.Store(true)
	m.mu.Lock()
	for domain, scopes := range m.subscribers {
		for scope, subscribers := range scopes {
			for _, sub := range subscribers {
				sub.close(DropReasonClosed)
			}
			m.clearScopeStateLocked(domain, scope)
		}
	}
	clear(m.subscribers)
	m.mu.Unlock()
}

func (m *Manager) logWarn(message string) {
	if m == nil {
		return
	}
	applog.Warn(m.logger, message, logsources.ResourceStream, m.clusterMeta.ClusterID, m.clusterMeta.ClusterName)
}

func (m *Manager) logInfo(message string) {
	if m == nil {
		return
	}
	applog.Info(m.logger, message, logsources.ResourceStream, m.clusterMeta.ClusterID, m.clusterMeta.ClusterName)
}

func (m *Manager) logDebug(message string) {
	if m == nil {
		return
	}
	applog.Debug(m.logger, message, logsources.ResourceStream, m.clusterMeta.ClusterID, m.clusterMeta.ClusterName)
}

func (m *Manager) invalidateSnapshotDomain(domain string) {
	if m != nil && m.snapshotDomainInvalidator != nil {
		m.snapshotDomainInvalidator(domain)
	}
}

// Ring publishes a committed change as this generation's doorbell: it
// invalidates the domain's cached snapshots, then delivers to the target
// scopes. After Stop it does nothing.
func (m *Manager) Ring(change doorbell.Change) {
	if m == nil {
		return
	}
	m.generation.Run(func() { m.deliver(change) })
}

// AfterFunc schedules a producer callback that Stop cancels or joins.
func (m *Manager) AfterFunc(d time.Duration, fn func()) doorbell.Timer {
	return m.generation.AfterFunc(d, fn)
}

var _ doorbell.Bell = (*Manager)(nil)

func (m *Manager) deliver(change doorbell.Change) {
	// The change happened whether or not anyone is subscribed, so a later read
	// must not serve the pre-change cached snapshot.
	m.invalidateSnapshotDomain(change.Domain)
	scopes, explicit := change.Target.ExplicitScopes()
	if !explicit {
		// Subscribed and matching targets ring only scopes someone subscribed to.
		scopes = m.targetSubscribedScopes(change)
	}
	if len(scopes) == 0 {
		return
	}
	if change.Reason != "" {
		m.logDebug(fmt.Sprintf("%s doorbell %s: %s — signaling %d scope(s) to refetch",
			change.Domain, change.Version, change.Reason, len(scopes)))
	}
	m.deliverScopes(change.Domain, scopes, m.changeUpdate(change))
}

func (m *Manager) targetSubscribedScopes(change doorbell.Change) []string {
	if change.Target.AllSubscribed() {
		return m.subscribedScopes(change.Domain)
	}
	matches, ok := change.Target.Matcher()
	if !ok {
		return nil
	}
	var targets []string
	for _, scope := range m.subscribedScopes(change.Domain) {
		if matches(scope) {
			targets = append(targets, scope)
		}
	}
	return targets
}

func (m *Manager) changeUpdate(change doorbell.Change) Update {
	updateType := change.Type
	if updateType == "" {
		updateType = MessageTypeModified
	}
	update := Update{
		Type:            updateType,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		Domain:          change.Domain,
		Source:          change.Source,
		Signal:          SignalChanged,
		Version:         strings.TrimSpace(change.Version),
		ResourceVersion: change.ResourceVersion,
	}
	if change.Ref != nil {
		ref := *change.Ref
		if strings.TrimSpace(ref.ClusterID) == "" {
			ref.ClusterID = m.clusterMeta.ClusterID
		}
		update.Ref = &ref
	}
	return update
}

// MetricDoorbellDomains lists the domains whose served rows join live metric
// samples: every projection-descriptor domain with a metric clock, the
// cluster overview, and the metric-only namespace utilization payload.
func MetricDoorbellDomains() []string {
	domains := make([]string, 0, len(projectionDescriptors)+2)
	for domain, descriptor := range projectionDescriptors {
		if descriptor.MetricsDependency() {
			domains = append(domains, domain)
		}
	}
	return append(domains, domainClusterOverview, domainNamespaceMetrics)
}

// NamespaceMetricsDomain is the metric-only namespace utilization payload,
// which also owns metric collection failures.
const NamespaceMetricsDomain = domainNamespaceMetrics

func (m *Manager) subscribedScopes(domain string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	domainSubs := m.subscribers[domain]
	if len(domainSubs) == 0 {
		return nil
	}
	scopes := make([]string, 0, len(domainSubs))
	for scope := range domainSubs {
		scopes = append(scopes, scope)
	}
	return scopes
}

func (m *Manager) prepareBroadcast(domain, scope string, update Update) (Update, []struct {
	id  uint64
	sub *subscription
}) {
	m.mu.Lock()
	defer m.mu.Unlock()

	scopedUpdate := update
	scopedUpdate.Scope = scope

	var scopeSubs map[uint64]*subscription
	if domainSubs, ok := m.subscribers[domain]; ok {
		scopeSubs = domainSubs[scope]
	}
	key := bufferKey(domain, scope)
	_, bufferExists := m.buffers[key]
	if len(scopeSubs) > 0 || bufferExists {
		// Buffer updates only when there are active or recent subscribers for this scope.
		sequence := m.nextSequenceLocked(domain, scope)
		sequenceToken := strconv.FormatUint(sequence, 10)
		scopedUpdate.Sequence = sequenceToken
		if scopedUpdate.Source == "" {
			scopedUpdate.Source = SourceObject
		}
		if scopedUpdate.Signal == "" {
			scopedUpdate.Signal = SignalChanged
		}
		if strings.TrimSpace(scopedUpdate.Version) == "" {
			scopedUpdate.Version = sequenceToken
		}
		buffer := m.bufferLocked(domain, scope)
		buffer.Add(bufferedUpdate{sequence: sequence, update: scopedUpdate})
	}
	if len(scopeSubs) == 0 {
		return scopedUpdate, nil
	}
	items := make([]struct {
		id  uint64
		sub *subscription
	}, 0, len(scopeSubs))
	for id, sub := range scopeSubs {
		items = append(items, struct {
			id  uint64
			sub *subscription
		}{id: id, sub: sub})
	}
	return scopedUpdate, items
}

func (m *Manager) nextSequenceLocked(domain, scope string) uint64 {
	key := bufferKey(domain, scope)
	if m.sequences == nil {
		m.sequences = make(map[string]uint64)
	}
	next := m.sequences[key] + 1
	m.sequences[key] = next
	return next
}

func (m *Manager) bufferLocked(domain, scope string) *updateBuffer {
	key := bufferKey(domain, scope)
	if m.buffers == nil {
		m.buffers = make(map[string]*updateBuffer)
	}
	buffer := m.buffers[key]
	if buffer == nil {
		buffer = newUpdateBuffer(config.ResourceStreamResumeBufferSize)
		m.buffers[key] = buffer
	}
	return buffer
}

// clearScopeStateLocked removes resume state for scopes without subscribers.
func (m *Manager) clearScopeStateLocked(domain, scope string) {
	key := bufferKey(domain, scope)
	if m.buffers != nil {
		delete(m.buffers, key)
	}
	if m.sequences != nil {
		delete(m.sequences, key)
	}
}

func (m *Manager) dropSubscriber(domain, scope string, id uint64, sub *subscription, reason DropReason) {
	m.mu.Lock()
	defer m.mu.Unlock()

	domainSubs, ok := m.subscribers[domain]
	if !ok {
		return
	}
	scopeSubs, ok := domainSubs[scope]
	if !ok {
		return
	}
	current, exists := scopeSubs[id]
	if !exists || current != sub {
		return
	}
	delete(scopeSubs, id)
	if len(scopeSubs) == 0 {
		delete(domainSubs, scope)
		m.clearScopeStateLocked(domain, scope)
	}
	if len(domainSubs) == 0 {
		delete(m.subscribers, domain)
	}
	sub.close(reason)
}

func (m *Manager) trySend(sub *subscription, update Update) (sent bool, closed bool, reset bool) {
	sub.deliveryMu.Lock()
	defer sub.deliveryMu.Unlock()
	if sub.closed {
		return false, true, false
	}
	select {
	case sub.ch <- update:
		return true, false, false
	default:
		if m.triggerResync(sub, update) {
			return false, false, true
		}
		return false, false, false
	}
}

func (m *Manager) triggerResync(sub *subscription, update Update) bool {
	if sub == nil {
		return false
	}
	reset := Update{
		Type:        MessageTypeReset,
		ClusterID:   update.ClusterID,
		ClusterName: update.ClusterName,
		Domain:      update.Domain,
		Scope:       update.Scope,
	}
	// Drop the oldest update to make room for the RESET signal.
	select {
	case <-sub.ch:
	default:
	}
	select {
	case sub.ch <- reset:
		return sub.markResyncing()
	default:
		return false
	}
}

func uniqueScopes(scopes []string) []string {
	seen := make(map[string]struct{}, len(scopes))
	uniq := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		key := strings.TrimSpace(scope)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		uniq = append(uniq, key)
	}
	return uniq
}

func bufferKey(domain, scope string) string {
	return strings.TrimSpace(domain) + "|" + strings.TrimSpace(scope)
}
