package resourcestream

import (
	"context"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func refPtr(ref resourcemodel.ResourceRef) *resourcemodel.ResourceRef { return &ref }

func requireNextUpdate(t *testing.T, sub *Subscription) Update {
	t.Helper()
	select {
	case update := <-sub.Updates:
		return update
	case <-time.After(time.Second):
		t.Fatal("expected update to be delivered")
		return Update{}
	}
}

func subscribeForTest(t *testing.T, manager *Manager, domain, scope string) (*Subscription, error) {
	t.Helper()
	selector, err := ParseStreamSelector(manager.clusterMeta.ClusterID, domain, scope)
	if err != nil {
		return nil, err
	}
	return manager.SubscribeSelector(selector)
}

func resumeForTest(t *testing.T, manager *Manager, domain, scope string, since uint64) ([]Update, bool) {
	t.Helper()
	selector, err := ParseStreamSelector(manager.clusterMeta.ClusterID, domain, scope)
	if err != nil {
		return nil, false
	}
	return manager.ResumeSelector(selector, since)
}

func TestManagerRejectsUnscopedAndForeignSubscriptionIdentity(t *testing.T) {
	manager := NewManager(nil, nil, snapshot.ClusterMeta{ClusterID: "c1"}, nil)
	t.Cleanup(manager.Stop)
	selector, err := ParseStreamSelector("c1", domainPods, "namespace:default")
	require.NoError(t, err)
	sub, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)
	for _, version := range []string{"1", "2"} {
		manager.Ring(doorbell.Change{
			Domain: domainPods, Source: doorbell.SourceObject, Target: doorbell.Scopes(selector.CanonicalScope()),
			Type: MessageTypeModified, ResourceVersion: version,
			Ref: refPtr(resourcemodel.ResourceRef{ClusterID: "c1", Version: "v1", Kind: "Pod", Namespace: "default", Name: "pod-a"}),
		})
		require.Equal(t, version, requireNextUpdate(t, sub).Sequence)
	}
	for _, clusterID := range []string{"", " ", "c2"} {
		t.Run("cluster="+clusterID, func(t *testing.T) {
			invalid := selector
			invalid.ClusterID = clusterID
			foreignSub, err := manager.SubscribeSelector(invalid)
			require.Error(t, err)
			require.Nil(t, foreignSub)
			updates, ok := manager.ResumeSelector(invalid, 1)
			require.False(t, ok)
			require.Empty(t, updates)
		})
	}
	updates, ok := manager.ResumeSelector(selector, 1)
	require.True(t, ok)
	require.Len(t, updates, 1)
	require.Equal(t, "2", updates[0].Sequence)
}

// A ring reaches exactly its target: explicit scopes, or every subscribed
// scope of the domain, each with the change's source clock and version.
func TestManagerRingDeliversToExplicitAndSubscribedTargets(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}
	catalogSub, err := subscribeForTest(t, manager, domainCatalog, "")
	require.NoError(t, err)
	clusterEventsSub, err := subscribeForTest(t, manager, domainClusterEvents, "")
	require.NoError(t, err)
	namespaceEventsSub, err := subscribeForTest(t, manager, domainNamespaceEvents, "namespace:prod")
	require.NoError(t, err)
	allNamespaceEventsSub, err := subscribeForTest(t, manager, domainNamespaceEvents, "namespace:all")
	require.NoError(t, err)

	manager.Ring(doorbell.Change{Domain: domainCatalog, Source: SourceCatalog, Target: doorbell.Subscribed(), Version: "catalog-42"})
	manager.Ring(doorbell.Change{Domain: domainClusterEvents, Source: SourceEvent, Target: doorbell.Scopes(""), Version: "event-7"})
	manager.Ring(doorbell.Change{Domain: domainNamespaceEvents, Source: SourceEvent, Target: doorbell.Scopes("namespace:prod", "namespace:all"), Version: "event-8"})

	for _, tc := range []struct {
		name    string
		sub     *Subscription
		domain  string
		scope   string
		source  Source
		version string
	}{
		{name: "catalog", sub: catalogSub, domain: domainCatalog, scope: "", source: SourceCatalog, version: "catalog-42"},
		{name: "cluster events", sub: clusterEventsSub, domain: domainClusterEvents, scope: "", source: SourceEvent, version: "event-7"},
		{name: "namespace events", sub: namespaceEventsSub, domain: domainNamespaceEvents, scope: "namespace:prod", source: SourceEvent, version: "event-8"},
		{name: "all namespace events", sub: allNamespaceEventsSub, domain: domainNamespaceEvents, scope: "namespace:all", source: SourceEvent, version: "event-8"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			update := requireNextUpdate(t, tc.sub)
			require.Equal(t, MessageTypeModified, update.Type)
			require.Equal(t, tc.domain, update.Domain)
			require.Equal(t, tc.scope, update.Scope)
			require.Equal(t, tc.source, update.Source)
			require.Equal(t, SignalChanged, update.Signal)
			require.Equal(t, tc.version, update.Version)
			require.Equal(t, "c1", update.ClusterID)
			require.Equal(t, "cluster", update.ClusterName)
			require.Nil(t, update.Ref)
		})
	}
}

// The namespaces doorbell subscription must be accepted as a cluster-scope
// selector, exactly like the catalog/cluster-events doorbells.
func TestParseStreamSelectorAcceptsNamespacesClusterScope(t *testing.T) {
	selector, err := ParseStreamSelector("c1", domainNamespaces, "")
	require.NoError(t, err)
	require.Equal(t, refresh.ClusterSelector(), selector.Selector)
	require.Equal(t, "", selector.CanonicalScope())

	_, err = ParseStreamSelector("c1", domainNamespaces, "namespace:default")
	require.Error(t, err)
}

// The object-events doorbell fans a SourceEvent signal ONLY to the subscribed
// scopes the flush's matcher selects — an event for one object must not ring
// sibling panels' doorbells.
func TestManagerBroadcastsObjectEventsDoorbellToMatchingScopes(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}
	matched, err := subscribeForTest(t, manager, domainObjectEvents, "team-a:/v1:Pod:web-1")
	require.NoError(t, err)
	other, err := subscribeForTest(t, manager, domainObjectEvents, "team-a:/v1:Pod:other")
	require.NoError(t, err)

	manager.Ring(doorbell.Change{
		Domain: domainObjectEvents, Source: SourceEvent, Version: "oe-3",
		Target: doorbell.Matching(func(scope string) bool { return scope == "team-a:/v1:Pod:web-1" }),
	})

	update := requireNextUpdate(t, matched)
	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainObjectEvents, update.Domain)
	require.Equal(t, "team-a:/v1:Pod:web-1", update.Scope)
	require.Equal(t, SourceEvent, update.Source)
	require.Equal(t, SignalChanged, update.Signal)
	require.Equal(t, "oe-3", update.Version)
	require.Nil(t, update.Ref)

	select {
	case unexpected := <-other.Updates:
		t.Fatalf("non-matching object scope must not receive the doorbell, got %+v", unexpected)
	default:
	}
}

// The object-events doorbell subscription is a per-object selector carrying
// the same scope tail the snapshot domain parses (namespace:group/version:kind:name).
func TestParseStreamSelectorAcceptsObjectEventsObjectScope(t *testing.T) {
	selector, err := ParseStreamSelector("c1", domainObjectEvents, "team-a:/v1:Pod:web-1")
	require.NoError(t, err)
	require.Equal(t, refresh.ScopeSelectorObject, selector.Selector.Kind)
	require.Equal(t, "team-a:/v1:Pod:web-1", selector.CanonicalScope())

	_, err = ParseStreamSelector("c1", domainObjectEvents, "")
	require.Error(t, err)
	_, err = ParseStreamSelector("c1", domainObjectEvents, "namespace:default")
	require.Error(t, err)
}

// TestManagerBroadcastsMetricDoorbellToMetricClockDomains pins the metric doorbell:
// a poller collection fans ONE SourceMetric doorbell to every subscribed scope of
// every metric-clock domain (pods/nodes/namespace-workloads — the domains whose rows
// join live usage at serve), and to nothing else. This is what lets the frontend
// refetch on the poller's schedule with NO client-side polling.
func TestManagerBroadcastsMetricDoorbellToMetricClockDomains(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}
	podsSub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)
	nodesSub, err := subscribeForTest(t, manager, domainNodes, "")
	require.NoError(t, err)
	workloadsSub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:prod")
	require.NoError(t, err)
	configSub, err := subscribeForTest(t, manager, domainNamespaceConfig, "namespace:default")
	require.NoError(t, err)
	// The cluster-overview snapshot joins live usage at serve too: its metric
	// doorbell resolves the "Collecting metrics…" card within one collection
	// instead of a full poll cycle. (Polls stay on for this domain — the
	// metric doorbell only rings on SUCCESSFUL collections, so a metrics-less
	// cluster would otherwise freeze the overview.)
	overviewSub, err := subscribeForTest(t, manager, domainClusterOverview, "")
	require.NoError(t, err)

	for _, domainName := range MetricDoorbellDomains() {
		manager.Ring(doorbell.Change{Domain: domainName, Source: SourceMetric, Target: doorbell.Subscribed(), Version: "metrics-99"})
	}

	for _, tc := range []struct {
		name   string
		sub    *Subscription
		domain string
		scope  string
	}{
		{name: "pods", sub: podsSub, domain: domainPods, scope: "namespace:default"},
		{name: "nodes", sub: nodesSub, domain: domainNodes, scope: ""},
		{name: "workloads", sub: workloadsSub, domain: domainWorkloads, scope: "namespace:prod"},
		{name: "cluster-overview", sub: overviewSub, domain: domainClusterOverview, scope: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			update := requireNextUpdate(t, tc.sub)
			require.Equal(t, MessageTypeModified, update.Type)
			require.Equal(t, tc.domain, update.Domain)
			require.Equal(t, tc.scope, update.Scope)
			require.Equal(t, SourceMetric, update.Source)
			require.Equal(t, SignalChanged, update.Signal)
			require.Equal(t, "metrics-99", update.Version)
			require.Nil(t, update.Ref)
		})
	}

	select {
	case update := <-configSub.Updates:
		t.Fatalf("non-metric domain must not receive a metric doorbell, got %+v", update)
	default:
	}
}

func TestManagerResumeReturnsBufferedUpdates(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}
	// Create a subscriber so the resume buffer is active for this scope.
	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)
	defer sub.Cancel()

	first := doorbell.Change{
		Domain:          domainPods,
		Source:          doorbell.SourceObject,
		Target:          doorbell.Scopes("namespace:default"),
		Type:            MessageTypeAdded,
		ResourceVersion: "1",
		Ref:             refPtr(resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: "c1", Group: "", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "pod-1", UID: "pod-1"})),
	}
	second := first
	second.ResourceVersion = "2"
	second.Ref = refPtr(resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: "c1", Group: "", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "pod-2", UID: "pod-2"}))

	manager.Ring(first)
	manager.Ring(second)

	updates, ok := resumeForTest(t, manager, domainPods, "namespace:default", 1)
	require.True(t, ok)
	require.Len(t, updates, 1)
	require.Equal(t, "2", updates[0].Sequence)
	require.Equal(t, "pod-2", updates[0].Ref.Name)
}

func TestManagerChangeSignalInvalidatesSnapshotCacheBeforeDelivery(t *testing.T) {
	reg := domain.New()
	builds := 0
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: domainClusterRBAC,
		BuildSnapshot: func(context.Context, string) (*refresh.Snapshot, error) {
			builds++
			return &refresh.Snapshot{Domain: domainClusterRBAC}, nil
		},
	}))
	service := snapshot.NewServiceWithPermissions(reg, nil, snapshot.ClusterMeta{ClusterID: "c1"}, nil)
	_, err := service.Build(context.Background(), domainClusterRBAC, "c1|")
	require.NoError(t, err)
	_, err = service.Build(context.Background(), domainClusterRBAC, "c1|")
	require.NoError(t, err)
	require.Equal(t, 1, builds, "pre-change snapshot must come from cache")

	manager := NewManager(nil, nil, snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, service.InvalidateDomainCache)
	sub, err := subscribeForTest(t, manager, domainClusterRBAC, "")
	require.NoError(t, err)
	defer sub.Cancel()

	manager.Ring(doorbell.Change{
		Domain:          domainClusterRBAC,
		Source:          doorbell.SourceObject,
		Target:          doorbell.Scopes(""),
		Type:            MessageTypeModified,
		ResourceVersion: "2",
		Ref:             refPtr(resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: "c1", Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole", Resource: "clusterroles", Namespace: "", Name: "admin", UID: "uid-admin"})),
	})
	require.Equal(t, domainClusterRBAC, requireNextUpdate(t, sub).Domain)

	_, err = service.Build(context.Background(), domainClusterRBAC, "c1|")
	require.NoError(t, err)
	require.Equal(t, 2, builds, "signal delivery must invalidate the pre-change snapshot")
}

func TestManagerEvictsResumeBufferWhenLastSubscriberCancels(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}

	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	change := doorbell.Change{
		Domain:          domainPods,
		Source:          doorbell.SourceObject,
		Target:          doorbell.Scopes("namespace:default"),
		Type:            MessageTypeAdded,
		ResourceVersion: "1",
		Ref:             refPtr(resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: "c1", Group: "", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "pod-1", UID: "pod-1"})),
	}
	manager.Ring(change)

	key := bufferKey(domainPods, "namespace:default")
	require.Contains(t, manager.buffers, key)
	require.Contains(t, manager.sequences, key)

	sub.Cancel()

	require.NotContains(t, manager.buffers, key)
	require.NotContains(t, manager.sequences, key)

	replacement, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)
	t.Cleanup(replacement.Cancel)
	sub.Cancel()
	manager.Ring(change)
	require.Equal(t, "1", requireNextUpdate(t, replacement).Sequence)
}

func (a podIngestStoreAdapter) RewriteBundlesByIndex(
	_ schema.GroupVersionResource,
	indexName string,
	values []string,
	rewrite func(ingest.Bundle) (ingest.Bundle, bool),
) []ingest.Bundle {
	return a.store.RewriteBundlesByIndex(indexName, values, rewrite)
}

// newRacedPodIngestStore projects pod through the REAL pod ingest projector with
// an EMPTY ReplicaSet lister — the connect-race state whose rows carry the
// unresolved ReplicaSet owner — and returns the store with its Table half retained.
func newRacedPodIngestStore(t *testing.T, pod *corev1.Pod) *ingest.ProjectingStore {
	t.Helper()
	project := snapshot.NewPodIngestProjector(
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		snapshot.PodOwnerSources{ReplicaSetOwner: testsupport.ReplicaSetOwnerLookup(testsupport.NewReplicaSetLister(t))},
	)
	store := ingest.NewProjectingStore(project)
	store.SetRetainTable(true)
	store.AddIndex(snapshot.PodOwnerKeyIndexName, snapshot.PodOwnerKeyIndexValues)
	require.NoError(t, store.Add(pod))
	return store
}

func racedOwnerPod() *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web-12345-abcde",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "7",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-12345",
				Controller: ptrBool(true),
				APIVersion: "apps/v1",
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
}

func TestJobBundleArrivalHealsPreviouslyProjectedCronJobPod(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Namespace: "batch",
		Name:      "nightly-29123456-abcde",
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "batch/v1", Kind: "Job", Name: "nightly-29123456", Controller: ptrBool(true),
		}},
	}}
	project := snapshot.NewPodIngestProjector(
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		snapshot.PodOwnerSources{},
	)
	store := ingest.NewProjectingStore(project)
	store.SetRetainTable(true)
	store.AddIndex(snapshot.PodOwnerKeyIndexName, snapshot.PodOwnerKeyIndexValues)
	require.NoError(t, store.Add(pod))
	manager.podIngest = podIngestStoreAdapter{store: store}

	job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{
		Namespace: "batch",
		Name:      "nightly-29123456",
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "batch/v1", Kind: "CronJob", Name: "nightly", Controller: ptrBool(true),
		}},
	}}
	raw, err := snapshot.NewJobIngestProjector(snapshot.ClusterMeta{ClusterID: "c1"})(job)
	require.NoError(t, err)
	jobPodOwnerHealBundleSink{manager: manager}.UpsertBundle(raw.(ingest.Bundle))

	rows := store.List()
	require.Len(t, rows, 1)
	row := rows[0].(ingest.Bundle).Table.(snapshot.PodSummary)
	require.Equal(t, "CronJob", row.OwnerKind)
	require.Equal(t, "nightly", row.OwnerName)
	require.Equal(t, "Job", row.DirectOwnerKind)
	require.Equal(t, "nightly-29123456", row.DirectOwnerName)
}

// TestManagerReplicaSetAddHealsRacedPodOwnerRows is the regression test for the
// empty Deployment Pods tab: a pod projected BEFORE its ReplicaSet was observed
// keeps OwnerKind=ReplicaSet, so the Deployment workload scope does not serve it.
// When the RS reflector delivers the ReplicaSet, the manager must heal the stored
// bundle. The pods store's ring for the healed row is covered end to end by
// system.TestReplicaSetHealRingsHealedPodScopes.
// healReplicaSet delivers a ReplicaSet's projected bundle to the heal sink, as
// its owned reflector's store does.
func healReplicaSet(t *testing.T, manager *Manager, rs *appsv1.ReplicaSet) {
	t.Helper()
	projected, err := snapshot.NewReplicaSetIngestProjector(manager.clusterMeta)(rs)
	require.NoError(t, err)
	replicaSetPodOwnerHealBundleSink{manager: manager}.UpsertBundle(projected.(ingest.Bundle))
}

func TestManagerReplicaSetAddHealsRacedPodOwnerRows(t *testing.T) {
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-12345",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "web",
				Controller: ptrBool(true),
				APIVersion: "apps/v1",
			}},
		},
	}
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	store := newRacedPodIngestStore(t, racedOwnerPod())
	manager.podIngest = podIngestStoreAdapter{store: store}

	healReplicaSet(t, manager, rs)

	// The stored bundle is healed: the collapsed owner now names the Deployment
	// while the direct owner keeps the ReplicaSet, so BOTH workload scopes serve it.
	rows := store.List()
	require.Len(t, rows, 1)
	healedRow := rows[0].(ingest.Bundle).Table.(snapshot.PodSummary)
	require.Equal(t, "Deployment", healedRow.OwnerKind)
	require.Equal(t, "web", healedRow.OwnerName)
	require.Equal(t, "ReplicaSet", healedRow.DirectOwnerKind)
	require.Equal(t, "web-12345", healedRow.DirectOwnerName)
}

// TestManagerReplicaSetModifiedHealsRacedPodOwnerRows covers the Modified branch:
// an RS observed without its Deployment owner (or raced the same way) whose owner
// reference is present on the update heals the raced rows identically.
func TestManagerReplicaSetModifiedHealsRacedPodOwnerRows(t *testing.T) {
	oldRS := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Name: "web-12345", Namespace: "default"},
	}
	newRS := oldRS.DeepCopy()
	newRS.OwnerReferences = []metav1.OwnerReference{{
		Kind:       "Deployment",
		Name:       "web",
		Controller: ptrBool(true),
		APIVersion: "apps/v1",
	}}
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	store := newRacedPodIngestStore(t, racedOwnerPod())
	manager.podIngest = podIngestStoreAdapter{store: store}

	healReplicaSet(t, manager, newRS)

	rows := store.List()
	require.Len(t, rows, 1)
	require.Equal(t, "Deployment", rows[0].(ingest.Bundle).Table.(snapshot.PodSummary).OwnerKind)
}

// TestManagerReplicaSetAddWithoutDeploymentOwnerDoesNotHeal: a standalone RS's
// pods correctly keep the ReplicaSet owner — the fallback scope IS their steady
// state, so the heal must decline and leave the row unchanged.
func TestManagerReplicaSetAddWithoutDeploymentOwnerDoesNotHeal(t *testing.T) {
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Name: "web-12345", Namespace: "default"},
	}
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	store := newRacedPodIngestStore(t, racedOwnerPod())
	manager.podIngest = podIngestStoreAdapter{store: store}

	healReplicaSet(t, manager, rs)

	rows := store.List()
	require.Len(t, rows, 1)
	require.Equal(t, "ReplicaSet", rows[0].(ingest.Bundle).Table.(snapshot.PodSummary).OwnerKind)
}

func TestManagerBackpressureTriggersReset(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	change := doorbell.Change{
		Domain: domainPods,
		Source: doorbell.SourceObject,
		Target: doorbell.Scopes("namespace:default"),
		Type:   MessageTypeAdded,
		Ref:    refPtr(resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: "c1", Group: "", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "pod-1", UID: ""})),
	}

	for i := 0; i < config.ResourceStreamSubscriberBufferSize+1; i++ {
		manager.Ring(change)
	}

	require.Eventually(t, func() bool {
		for i := 0; i < config.ResourceStreamSubscriberBufferSize+1; i++ {
			select {
			case msg := <-sub.Updates:
				if msg.Type == MessageTypeReset {
					return true
				}
			default:
				return false
			}
		}
		return false
	}, time.Second, 10*time.Millisecond)

	select {
	case reason := <-sub.Drops:
		t.Fatalf("unexpected drop: %s", reason)
	default:
	}
}

func ptrBool(value bool) *bool {
	return &value
}

func TestStoppedManagerCompletesSubscribersAndRejectsNewOnes(t *testing.T) {
	manager := NewManager(nil, nil, snapshot.ClusterMeta{ClusterID: "cluster-a"}, nil)
	sub, err := subscribeForTest(t, manager, "pods", "namespace:default")
	require.NoError(t, err)
	manager.Stop()
	select {
	case reason := <-sub.Drops:
		require.Equal(t, DropReasonClosed, reason)
	default:
		t.Fatal("stopped producer left a healthy-looking subscription")
	}
	_, err = subscribeForTest(t, manager, "pods", "namespace:default")
	require.Error(t, err, "a stopped producer must not ACK new subscriptions")
	sub.Cancel()
	manager.Stop()
}

func TestSubscriptionCloseSerializesWithDelivery(t *testing.T) {
	manager := NewManager(nil, nil, snapshot.ClusterMeta{ClusterID: "cluster-a"}, nil)
	for range 100 {
		sub := &subscription{ch: make(chan Update, 1), drops: make(chan DropReason, 1)}
		started := make(chan struct{})
		done := make(chan struct{})
		go func() {
			close(started)
			defer close(done)
			for range 100 {
				manager.trySend(sub, Update{})
			}
		}()
		<-started
		sub.close(DropReasonClosed)
		<-done
	}
}

// A failed subscribe belongs to the domain that asked. Recorded on the shared
// socket instead, one domain's failure would mark every domain card that
// summarizes this socket (Catalog, Events) as failing.
func TestSubscribeFailuresAreAttributedToTheRequestingDomain(t *testing.T) {
	recorder := telemetry.NewRecorder()
	manager := NewManager(nil, recorder, snapshot.ClusterMeta{ClusterID: "c1"}, nil)
	selector, err := ParseStreamSelector("c1", domainNamespaceEvents, "namespace:prod")
	require.NoError(t, err)
	for i := 0; i < config.ResourceStreamMaxSubscribersPerScope; i++ {
		_, err := manager.SubscribeSelector(selector)
		require.NoError(t, err)
	}
	_, err = manager.SubscribeSelector(selector)
	require.Error(t, err)

	var socketErrors, domainErrors uint64
	for _, status := range recorder.SnapshotSummary().Streams {
		if status.Name != telemetry.StreamResources {
			continue
		}
		switch {
		case status.LeafKind == telemetry.StreamLeafNone:
			socketErrors += status.ErrorCount
		case status.LeafKind == telemetry.StreamLeafDomain && status.Leaf == domainNamespaceEvents:
			domainErrors += status.ErrorCount
		}
	}
	require.Equal(t, uint64(0), socketErrors, "the shared socket did not fail")
	require.Equal(t, uint64(1), domainErrors, "the namespace-events subscribe failed")
}

type podIngestStoreAdapter struct {
	store *ingest.ProjectingStore
}
