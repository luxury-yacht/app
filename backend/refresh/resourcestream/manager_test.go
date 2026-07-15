package resourcestream

import (
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	rolepkg "github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func refPtr(ref resourcemodel.ResourceRef) *resourcemodel.ResourceRef { return &ref }

func requireUpdateObjectMetadata(t *testing.T, update Update, resourceVersion, uid, name, namespace, kind string) {
	t.Helper()
	require.Equal(t, "c1", update.ClusterID)
	require.Equal(t, "cluster", update.ClusterName)
	require.Equal(t, resourceVersion, update.ResourceVersion)
	require.NotNil(t, update.Ref)
	require.Equal(t, update.ClusterID, update.Ref.ClusterID)
	require.Equal(t, uid, update.Ref.UID)
	require.Equal(t, name, update.Ref.Name)
	require.Equal(t, namespace, update.Ref.Namespace)
	require.Equal(t, kind, update.Ref.Kind)
}

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

func TestManagerPodUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}

	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "12",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-a",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	manager.handlePod(pod, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainPods, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, SourceObject, update.Source)
		require.Equal(t, SignalChanged, update.Signal)
		require.Equal(t, "1", update.Version)
		require.Equal(t, "pod-1", update.Ref.Name)
		require.Equal(t, "default", update.Ref.Namespace)
		// pods is query-backed: the live stream carries the change signal, not the row.
	default:
		t.Fatal("expected update to be delivered")
	}
}

func TestManagerBroadcastsEventAndCatalogDoorbellSources(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}
	catalogSub, err := subscribeForTest(t, manager, domainCatalog, "")
	require.NoError(t, err)
	clusterEventsSub, err := subscribeForTest(t, manager, domainClusterEvents, "cluster")
	require.NoError(t, err)
	namespaceEventsSub, err := subscribeForTest(t, manager, domainNamespaceEvents, "namespace:prod")
	require.NoError(t, err)

	manager.BroadcastCatalogRefresh("catalog-42")
	manager.BroadcastEventRefresh(domainClusterEvents, "", "event-7")
	manager.BroadcastEventRefresh(domainNamespaceEvents, "namespace:prod", "event-8")

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

// TestManagerBroadcastsNamespacesDoorbell pins the namespaces doorbell: namespace
// object changes and workload-presence flips fan ONE SourceObject doorbell to the
// namespaces domain's subscribers, so the sidebar refetches on push instead of the
// 2s poll.
func TestManagerBroadcastsNamespacesDoorbell(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaces, "")
	require.NoError(t, err)

	manager.BroadcastNamespacesRefresh("ns-7", "namespace object changed")

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNamespaces, update.Domain)
	require.Equal(t, "", update.Scope)
	require.Equal(t, SourceObject, update.Source)
	require.Equal(t, SignalChanged, update.Signal)
	require.Equal(t, "ns-7", update.Version)
	require.Nil(t, update.Ref)
}

// The namespaces doorbell subscription must be accepted as a cluster-scope
// selector, exactly like the catalog/cluster-events doorbells.
func TestParseStreamSelectorAcceptsNamespacesClusterScope(t *testing.T) {
	selector, err := ParseStreamSelector("c1", domainNamespaces, "")
	require.NoError(t, err)
	require.Equal(t, StreamScopeCluster, selector.ScopeKind)
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

	manager.BroadcastObjectEventsRefresh("oe-3", func(scope string) bool {
		return scope == "team-a:/v1:Pod:web-1"
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
	require.Equal(t, StreamScopeObject, selector.ScopeKind)
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

	manager.BroadcastMetricsRefresh("metrics-99")

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

// The namespace-config live notify is now driven by the generic ingest notify sink
// (ConfigMap/Secret are owned-reflector ingest kinds), proven in ingest_notify_test.go.
// The resource-stream handleConfigMap/handleSecret handlers carry only the Helm-release
// refresh side-effect, covered by the Helm broadcast tests below.

func TestManagerRBACUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceRBAC, "namespace:default")
	require.NoError(t, err)

	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "role-1",
			Namespace:       "default",
			UID:             "role-uid",
			ResourceVersion: "4",
		},
	}

	manager.streamObjectRowFromDescriptor(role, MessageTypeAdded, rolepkg.StreamDescriptor)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceRBAC, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		requireUpdateObjectMetadata(t, update, "4", "role-uid", "role-1", "default", "Role")
	default:
		t.Fatal("expected rbac update to be delivered")
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

	first := Update{
		Type:            MessageTypeAdded,
		Domain:          domainPods,
		ClusterID:       "c1",
		ClusterName:     "cluster",
		ResourceVersion: "1",
		Ref:             refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-1", "pod-1")),
	}
	second := first
	second.ResourceVersion = "2"
	second.Ref = refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-2", "pod-2"))

	manager.broadcast(domainPods, []string{"namespace:default"}, first)
	manager.broadcast(domainPods, []string{"namespace:default"}, second)

	updates, ok := resumeForTest(t, manager, domainPods, "namespace:default", 1)
	require.True(t, ok)
	require.Len(t, updates, 1)
	require.Equal(t, "2", updates[0].Sequence)
	require.Equal(t, "pod-2", updates[0].Ref.Name)
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

	update := Update{
		Type:            MessageTypeAdded,
		Domain:          domainPods,
		ClusterID:       "c1",
		ClusterName:     "cluster",
		ResourceVersion: "1",
		Ref:             refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-1", "pod-1")),
	}
	manager.broadcast(domainPods, []string{"namespace:default"}, update)

	key := bufferKey(domainPods, "namespace:default")
	require.Contains(t, manager.buffers, key)
	require.Contains(t, manager.sequences, key)

	sub.Cancel()

	require.NotContains(t, manager.buffers, key)
	require.NotContains(t, manager.sequences, key)
}

func TestManagerClusterRBACUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainClusterRBAC, "")
	require.NoError(t, err)

	role := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "cluster-role-1",
			UID:             "cr-uid",
			ResourceVersion: "10",
		},
	}

	manager.streamObjectRowFromDescriptor(role, MessageTypeAdded, clusterrole.StreamDescriptor)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterRBAC, update.Domain)
		require.Equal(t, "", update.Scope)
		requireUpdateObjectMetadata(t, update, "10", "cr-uid", "cluster-role-1", "", "ClusterRole")
	default:
		t.Fatal("expected cluster rbac update to be delivered")
	}
}

func TestManagerQuotasUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceQuotas, "namespace:default")
	require.NoError(t, err)

	quota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "quota-1",
			Namespace:       "default",
			UID:             "quota-uid",
			ResourceVersion: "7",
		},
	}

	manager.streamObjectRowFromDescriptor(quota, MessageTypeAdded, resourcequota.StreamDescriptor)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceQuotas, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		requireUpdateObjectMetadata(t, update, "7", "quota-uid", "quota-1", "default", "ResourceQuota")
	default:
		t.Fatal("expected quotas update to be delivered")
	}
}

func TestManagerNetworkUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceNetwork, "namespace:default")
	require.NoError(t, err)

	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "svc-1",
			Namespace:       "default",
			UID:             "svc-uid",
			ResourceVersion: "3",
		},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.1",
		},
	}

	manager.handleService(service, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceNetwork, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		requireUpdateObjectMetadata(t, update, "3", "svc-uid", "svc-1", "default", "Service")
	default:
		t.Fatal("expected network update to be delivered")
	}
}

func TestManagerClusterConfigUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainClusterConfig, "")
	require.NoError(t, err)

	storageClass := &storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "fast",
			UID:             "sc-uid",
			ResourceVersion: "2",
		},
		Provisioner: "kubernetes.io/no-provisioner",
	}

	manager.streamObjectRowFromDescriptor(storageClass, MessageTypeAdded, storageclass.StreamDescriptor)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterConfig, update.Domain)
		require.Equal(t, "", update.Scope)
		requireUpdateObjectMetadata(t, update, "2", "sc-uid", "fast", "", "StorageClass")
		// cluster-config is query-backed: the change signal (Ref + ResourceVersion)
		// is delivered so the table refetches, but the projected Row is omitted
		// because nothing renders the streamed rows.
	default:
		t.Fatal("expected cluster config update to be delivered")
	}
}

func TestManagerStorageUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceStorage, "namespace:default")
	require.NoError(t, err)

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pvc-1",
			Namespace:       "default",
			UID:             "pvc-uid",
			ResourceVersion: "2",
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
		},
	}

	manager.streamObjectRowFromDescriptor(pvc, MessageTypeAdded, persistentvolumeclaim.StreamDescriptor)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceStorage, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		requireUpdateObjectMetadata(t, update, "2", "pvc-uid", "pvc-1", "default", "PersistentVolumeClaim")
	default:
		t.Fatal("expected storage update to be delivered")
	}
}

func TestManagerClusterStorageUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainClusterStorage, "")
	require.NoError(t, err)

	pv := &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pv-1",
			UID:             "pv-uid",
			ResourceVersion: "5",
		},
		Status: corev1.PersistentVolumeStatus{
			Phase: corev1.VolumeBound,
		},
	}

	manager.streamObjectRowFromDescriptor(pv, MessageTypeAdded, persistentvolume.StreamDescriptor)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterStorage, update.Domain)
		require.Equal(t, "", update.Scope)
		requireUpdateObjectMetadata(t, update, "5", "pv-uid", "pv-1", "", "PersistentVolume")
	default:
		t.Fatal("expected cluster storage update to be delivered")
	}
}

func TestManagerCustomUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceCustom, "namespace:default")
	require.NoError(t, err)

	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	resource.SetName("widget-1")
	resource.SetNamespace("default")
	resource.SetUID("widget-uid")
	resource.SetResourceVersion("2")
	resource.SetCreationTimestamp(metav1.NewTime(time.Now().Add(-time.Minute)))

	info := &customResourceInformer{
		gvr:  schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		kind: "Widget",
	}

	manager.handleCustomResource(resource, MessageTypeAdded, info)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceCustom, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "widget-1", update.Ref.Name)
		require.Equal(t, "default", update.Ref.Namespace)
		require.Equal(t, "Widget", update.Ref.Kind)
		require.Equal(t, "example.com", update.Ref.Group)
		require.Equal(t, "v1", update.Ref.Version)
	default:
		t.Fatal("expected custom update to be delivered")
	}
}

func TestManagerCustomUpdateInvalidatesCache(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	_, err := subscribeForTest(t, manager, domainNamespaceCustom, "namespace:default")
	require.NoError(t, err)

	var called bool
	var gotKind, gotNamespace, gotName string
	manager.SetCustomResourceCacheInvalidator(func(kind, namespace, name string) {
		called = true
		gotKind = kind
		gotNamespace = namespace
		gotName = name
	})

	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	resource.SetName("widget-1")
	resource.SetNamespace("default")

	info := &customResourceInformer{
		gvr:  schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		kind: "Widget",
	}

	manager.handleCustomResource(resource, MessageTypeModified, info)

	require.True(t, called)
	require.Equal(t, "Widget", gotKind)
	require.Equal(t, "default", gotNamespace)
	require.Equal(t, "widget-1", gotName)
}

func TestManagerSkipsCustomInformerForFirstClassGatewayCRD(t *testing.T) {
	existingStopCh := make(chan struct{})
	manager := &Manager{
		clusterMeta:     snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:          applog.Noop,
		dynamicClient:   dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
		customInformers: make(map[string]*customResourceInformer),
		subscribers:     make(map[string]map[string]map[uint64]*subscription),
	}
	manager.customInformers["gateways.gateway.networking.k8s.io"] = &customResourceInformer{
		stopCh: existingStopCh,
	}

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "gateways.gateway.networking.k8s.io"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "gateway.networking.k8s.io",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "gateways",
				Kind:   "Gateway",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}

	manager.handleCustomResourceDefinition(crd, MessageTypeModified)

	require.Empty(t, manager.customInformers)
	select {
	case <-existingStopCh:
	default:
		t.Fatal("expected stale custom informer to be stopped")
	}
}

func TestManagerDoesNotRecreateCustomInformerAfterStop(t *testing.T) {
	manager := &Manager{
		clusterMeta:     snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:          applog.Noop,
		dynamicClient:   dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
		customInformers: make(map[string]*customResourceInformer),
		subscribers:     make(map[string]map[string]map[uint64]*subscription),
	}

	// Teardown drains the custom informers and marks the manager stopped.
	manager.Stop()

	// A CRD event arriving after Stop (e.g. an informer resync firing during the
	// teardown window, before the shared CRD informer is shut down) must not
	// resurrect a custom informer. Re-creating one here would spawn a goroutine
	// and a dynamic watch on a stopCh that nothing will ever close — a permanent
	// goroutine + watch leak.
	crd := customResourceDefinition("widgets.example.com", "example.com", "widgets", "Widget", apiextensionsv1.NamespaceScoped, "1")
	manager.handleCustomResourceDefinition(crd, MessageTypeAdded)

	require.Empty(t, manager.customInformers, "stopped manager must not re-create custom informers")
}

func TestManagerCRDSignatureChangeCompletesCustomDomain(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceCustom, "namespace:default")
	require.NoError(t, err)

	oldCRD := customResourceDefinition("widgets.example.com", "example.com", "widgets", "Widget", apiextensionsv1.NamespaceScoped, "10")
	newCRD := oldCRD.DeepCopy()
	newCRD.ResourceVersion = "11"
	newCRD.Spec.Names.Kind = "RenamedWidget"

	manager.handleCustomResourceDefinitionEvent(oldCRD, newCRD, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainNamespaceCustom, update.Domain)
	require.Equal(t, "namespace:default", update.Scope)
	require.Equal(t, "11", update.ResourceVersion)
	require.NotNil(t, update.Ref)
	require.Equal(t, "c1", update.Ref.ClusterID)
	require.Equal(t, "apiextensions.k8s.io", update.Ref.Group)
	require.Equal(t, "v1", update.Ref.Version)
	require.Equal(t, "CustomResourceDefinition", update.Ref.Kind)
	require.Equal(t, "widgets.example.com", update.Ref.Name)
}

func TestManagerClusterCustomCRDSignatureChangeCompletesCustomDomain(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainClusterCustom, "")
	require.NoError(t, err)

	oldCRD := customResourceDefinition("clusterwidgets.example.com", "example.com", "clusterwidgets", "ClusterWidget", apiextensionsv1.ClusterScoped, "10")
	newCRD := oldCRD.DeepCopy()
	newCRD.ResourceVersion = "11"
	newCRD.Spec.Names.Plural = "renamedclusterwidgets"

	manager.handleCustomResourceDefinitionEvent(oldCRD, newCRD, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainClusterCustom, update.Domain)
	require.Equal(t, "", update.Scope)
	require.Equal(t, "11", update.ResourceVersion)
	require.NotNil(t, update.Ref)
	require.Equal(t, "c1", update.Ref.ClusterID)
	require.Equal(t, "apiextensions.k8s.io", update.Ref.Group)
	require.Equal(t, "v1", update.Ref.Version)
	require.Equal(t, "CustomResourceDefinition", update.Ref.Kind)
	require.Equal(t, "clusterwidgets.example.com", update.Ref.Name)
}

func TestManagerClusterCustomUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainClusterCustom, "")
	require.NoError(t, err)

	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	resource.SetName("widget-cluster")
	resource.SetUID("widget-cluster-uid")
	resource.SetResourceVersion("2")
	resource.SetCreationTimestamp(metav1.NewTime(time.Now().Add(-time.Minute)))

	info := &customResourceInformer{
		gvr:    schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		kind:   "Widget",
		domain: domainClusterCustom,
	}

	manager.handleCustomResource(resource, MessageTypeAdded, info)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterCustom, update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, "widget-cluster", update.Ref.Name)
		require.Equal(t, "Widget", update.Ref.Kind)
		require.Equal(t, "example.com", update.Ref.Group)
		require.Equal(t, "v1", update.Ref.Version)
	default:
		t.Fatal("expected cluster custom update to be delivered")
	}
}

func TestManagerClusterCRDUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainClusterCRDs, "")
	require.NoError(t, err)

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "widgets.example.com",
			UID:             "crd-uid",
			ResourceVersion: "8",
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "widgets",
				Kind:   "Widget",
			},
			Scope: apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}

	manager.handleClusterCRD(crd, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterCRDs, update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, "widgets.example.com", update.Ref.Name)
		require.Equal(t, "CustomResourceDefinition", update.Ref.Kind)
	default:
		t.Fatal("expected cluster CRD update to be delivered")
	}
}

func TestManagerHelmUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceHelm, "namespace:default")
	require.NoError(t, err)

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "sh.helm.release.v1.demo.v1",
			Namespace:       "default",
			UID:             "helm-uid",
			ResourceVersion: "5",
			Labels: map[string]string{
				"owner": "helm",
			},
		},
		Type: corev1.SecretType(helmReleaseSecretType),
	}

	manager.handleSecret(secret, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeComplete, update.Type)
		require.Equal(t, domainNamespaceHelm, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "demo", update.Ref.Name)
		require.Equal(t, "default", update.Ref.Namespace)
		require.Equal(t, "helm.sh", update.Ref.Group)
		require.Equal(t, "v3", update.Ref.Version)
		require.Equal(t, "HelmRelease", update.Ref.Kind)
	default:
		t.Fatal("expected helm update to be delivered")
	}
}

func TestManagerSecretUpdateRefreshesOldHelmReleaseWhenRelationChanges(t *testing.T) {
	oldSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "sh.helm.release.v1.demo.v1",
			Namespace:       "default",
			UID:             "helm-uid",
			ResourceVersion: "5",
			Labels:          map[string]string{"owner": "helm"},
		},
		Type: corev1.SecretType(helmReleaseSecretType),
	}
	newSecret := oldSecret.DeepCopy()
	newSecret.ResourceVersion = "6"
	newSecret.Labels = nil
	newSecret.Type = corev1.SecretTypeOpaque
	newSecret.Name = "ordinary-secret"
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceHelm, "namespace:default")
	require.NoError(t, err)

	manager.handleSecretEvent(oldSecret, newSecret, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainNamespaceHelm, update.Domain)
	require.Equal(t, "demo", update.Ref.Name)
	require.Equal(t, "default", update.Ref.Namespace)
	require.Equal(t, "helm.sh", update.Ref.Group)
	require.Equal(t, "v3", update.Ref.Version)
	require.Equal(t, "HelmRelease", update.Ref.Kind)
}

func TestManagerConfigMapUpdateRefreshesOldHelmReleaseWhenRelationChanges(t *testing.T) {
	oldConfigMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "sh.helm.release.v1.demo.v1",
			Namespace:       "default",
			UID:             "helm-cm-uid",
			ResourceVersion: "5",
			Labels:          map[string]string{"owner": "helm"},
		},
	}
	newConfigMap := oldConfigMap.DeepCopy()
	newConfigMap.ResourceVersion = "6"
	newConfigMap.Labels = nil
	newConfigMap.Name = "ordinary-config"
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceHelm, "namespace:default")
	require.NoError(t, err)

	manager.handleConfigMapEvent(oldConfigMap, newConfigMap, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainNamespaceHelm, update.Domain)
	require.Equal(t, "demo", update.Ref.Name)
	require.Equal(t, "default", update.Ref.Namespace)
	require.Equal(t, "helm.sh", update.Ref.Group)
	require.Equal(t, "v3", update.Ref.Version)
	require.Equal(t, "HelmRelease", update.Ref.Kind)
}

func TestManagerAutoscalingUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceAutoscaling, "namespace:default")
	require.NoError(t, err)

	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "hpa-1",
			Namespace:       "default",
			UID:             "hpa-uid",
			ResourceVersion: "3",
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			MaxReplicas: 3,
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				Kind: "Deployment",
				Name: "app",
			},
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 2,
		},
	}

	manager.handleHPA(hpa, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceAutoscaling, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		requireUpdateObjectMetadata(t, update, "3", "hpa-uid", "hpa-1", "default", "HorizontalPodAutoscaler")
	default:
		t.Fatal("expected autoscaling update to be delivered")
	}
}

func TestManagerWorkloadEventBroadcastsNotifyOnly(t *testing.T) {
	replicas := int32(2)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web",
			Namespace:       "default",
			UID:             "deploy-uid",
			ResourceVersion: "9",
		},
		Spec: appsv1.DeploymentSpec{Replicas: &replicas},
	}
	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           applog.Noop,
		deploymentLister: testsupport.NewDeploymentLister(t, deployment),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handleWorkload(deployment, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, domainWorkloads, update.Domain)
	require.Equal(t, "namespace:default", update.Scope)
	require.Equal(t, "web", update.Ref.Name)
	require.Equal(t, "Deployment", update.Ref.Kind)
	// namespace-workloads is query-backed: the live stream carries the change
	// signal, not the row. HPA context in the row is covered in the snapshot path.
}

func TestManagerHPADeleteRefreshesTargetWorkloadRow(t *testing.T) {
	replicas := int32(2)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: "deploy-uid", ResourceVersion: "9"},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default", UID: "hpa-uid", ResourceVersion: "11"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			MaxReplicas: 5,
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
		},
	}
	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           applog.Noop,
		deploymentLister: testsupport.NewDeploymentLister(t, deployment),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handleHPA(hpa, MessageTypeDeleted)

	update := requireNextUpdate(t, sub)
	require.Equal(t, domainWorkloads, update.Domain)
	require.Equal(t, "web", update.Ref.Name)
}

func TestManagerHPAUpdateRefreshesOldAndNewTargets(t *testing.T) {
	replicas := int32(1)
	oldDeployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web-old", Namespace: "default", UID: "old-uid", ResourceVersion: "7"},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}
	newDeployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web-new", Namespace: "default", UID: "new-uid", ResourceVersion: "8"},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}
	oldHPA := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default", UID: "hpa-uid", ResourceVersion: "10"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			MaxReplicas:    5,
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web-old"},
		},
	}
	newHPA := oldHPA.DeepCopy()
	newHPA.ResourceVersion = "11"
	newHPA.Spec.ScaleTargetRef.Name = "web-new"
	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           applog.Noop,
		deploymentLister: testsupport.NewDeploymentLister(t, oldDeployment, newDeployment),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handleHPAEvent(oldHPA, newHPA, MessageTypeModified)

	names := map[string]bool{}
	for i := 0; i < 2; i++ {
		update := requireNextUpdate(t, sub)
		require.Equal(t, domainWorkloads, update.Domain)
		names[update.Ref.Name] = true
	}
	require.True(t, names["web-new"])
	require.True(t, names["web-old"])
}

func TestManagerPodMoveRefreshesOldAndNewNodeRows(t *testing.T) {
	oldPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "default", UID: "pod-uid", ResourceVersion: "1"},
		Spec:       corev1.PodSpec{NodeName: "node-a"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	newPod := oldPod.DeepCopy()
	newPod.ResourceVersion = "2"
	newPod.Spec.NodeName = "node-b"
	nodeA := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a", UID: "node-a-uid", ResourceVersion: "5"}}
	nodeB := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-b", UID: "node-b-uid", ResourceVersion: "6"}}
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		nodeLister:  testsupport.NewNodeLister(t, nodeA, nodeB),
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNodes, "")
	require.NoError(t, err)

	manager.handlePodEvent(oldPod, newPod, MessageTypeModified)

	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		update := requireNextUpdate(t, sub)
		seen[update.Ref.Name] = true
	}
	require.True(t, seen["node-a"])
	require.True(t, seen["node-b"])
}

func TestManagerPodMoveDeletesOldNodePodScope(t *testing.T) {
	oldPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "default", UID: "pod-uid", ResourceVersion: "1"},
		Spec:       corev1.PodSpec{NodeName: "node-a"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	newPod := oldPod.DeepCopy()
	newPod.ResourceVersion = "2"
	newPod.Spec.NodeName = "node-b"
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	oldNodeSub, err := subscribeForTest(t, manager, domainPods, "node:node-a")
	require.NoError(t, err)
	newNodeSub, err := subscribeForTest(t, manager, domainPods, "node:node-b")
	require.NoError(t, err)

	manager.handlePodEvent(oldPod, newPod, MessageTypeModified)

	oldNodeUpdate := requireNextUpdate(t, oldNodeSub)
	require.Equal(t, MessageTypeDeleted, oldNodeUpdate.Type)
	require.Equal(t, "pod-1", oldNodeUpdate.Ref.Name)

	newNodeUpdate := requireNextUpdate(t, newNodeSub)
	require.Equal(t, MessageTypeModified, newNodeUpdate.Type)
	require.Equal(t, "pod-1", newNodeUpdate.Ref.Name)
}

func TestManagerEndpointSliceRetargetRefreshesOldAndNewServices(t *testing.T) {
	oldSlice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "slice-1",
			Namespace:       "default",
			UID:             "slice-uid",
			ResourceVersion: "1",
			Labels:          map[string]string{discoveryv1.LabelServiceName: "old-svc"},
		},
	}
	newSlice := oldSlice.DeepCopy()
	newSlice.ResourceVersion = "2"
	newSlice.Labels = map[string]string{discoveryv1.LabelServiceName: "new-svc"}
	oldService := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "old-svc", Namespace: "default", UID: "old-svc-uid"}}
	newService := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "new-svc", Namespace: "default", UID: "new-svc-uid"}}
	manager := &Manager{
		clusterMeta:   snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:        applog.Noop,
		serviceLister: testsupport.NewServiceLister(t, oldService, newService),
		sliceLister:   testsupport.NewEndpointSliceLister(t, newSlice),
		subscribers:   make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceNetwork, "namespace:default")
	require.NoError(t, err)

	manager.handleEndpointSliceEvent(oldSlice, newSlice, MessageTypeModified)

	seenServices := map[string]bool{}
	for i := 0; i < 3; i++ {
		update := requireNextUpdate(t, sub)
		if update.Ref.Kind == "Service" {
			seenServices[update.Ref.Name] = true
		}
	}
	require.True(t, seenServices["old-svc"])
	require.True(t, seenServices["new-svc"])
}

// podIngestStoreAdapter adapts a raw ProjectingStore to the manager's
// podBundleSource seam, standing in for the production IngestManager (whose
// methods delegate to the same store calls).
type podIngestStoreAdapter struct {
	store *ingest.ProjectingStore
}

func (a podIngestStoreAdapter) Rows(schema.GroupVersionResource) []interface{} {
	return a.store.List()
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
// unresolved ReplicaSet owner — and returns the store wired the production way
// (retained Table half + the manager's pod notify bundle sink).
func newRacedPodIngestStore(t *testing.T, manager *Manager, pod *corev1.Pod) *ingest.ProjectingStore {
	t.Helper()
	project := snapshot.NewPodIngestProjector(
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		testsupport.NewReplicaSetLister(t),
	)
	store := ingest.NewProjectingStore(project)
	store.SetRetainTable(true)
	require.NoError(t, store.Add(pod))
	store.AddBundleSink(podNotifyBundleSink{manager: manager})
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

// TestManagerReplicaSetAddHealsRacedPodOwnerRows is the regression test for the
// empty Deployment Pods tab: a pod projected BEFORE its ReplicaSet was observed
// keeps OwnerKind=ReplicaSet, so the Deployment workload scope neither serves nor
// signals it. When the RS informer delivers the ReplicaSet, the manager must heal
// the stored bundle (store + maintained-store sink) and signal both the new
// Deployment scope (Modified) and the stale ReplicaSet fallback scope (Deleted).
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
	store := newRacedPodIngestStore(t, manager, racedOwnerPod())
	manager.podIngest = podIngestStoreAdapter{store: store}

	deploymentSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:Deployment:web")
	require.NoError(t, err)
	rsSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:ReplicaSet:web-12345")
	require.NoError(t, err)
	namespaceSub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	manager.handleReplicaSetEvent(nil, rs, MessageTypeAdded)

	// The stored bundle is healed: the collapsed owner now names the Deployment
	// while the direct owner keeps the ReplicaSet, so BOTH workload scopes serve it.
	rows := store.List()
	require.Len(t, rows, 1)
	healedRow := rows[0].(ingest.Bundle).Table.(snapshot.PodSummary)
	require.Equal(t, "Deployment", healedRow.OwnerKind)
	require.Equal(t, "web", healedRow.OwnerName)
	require.Equal(t, "ReplicaSet", healedRow.DirectOwnerKind)
	require.Equal(t, "web-12345", healedRow.DirectOwnerName)

	// Doorbell: the Deployment-scoped window learns its pods changed...
	deploymentUpdate := requireNextUpdate(t, deploymentSub)
	require.Equal(t, MessageTypeModified, deploymentUpdate.Type)
	require.Equal(t, "web-12345-abcde", deploymentUpdate.Ref.Name)

	// ...the ReplicaSet-scoped window too — the healed row still belongs to it
	// through its direct owner...
	rsUpdate := requireNextUpdate(t, rsSub)
	require.Equal(t, MessageTypeModified, rsUpdate.Type)
	require.Equal(t, "web-12345-abcde", rsUpdate.Ref.Name)

	// ...and the namespace scope sees the row change like any pod update.
	namespaceUpdate := requireNextUpdate(t, namespaceSub)
	require.Equal(t, MessageTypeModified, namespaceUpdate.Type)
	require.Equal(t, "web-12345-abcde", namespaceUpdate.Ref.Name)
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
	store := newRacedPodIngestStore(t, manager, racedOwnerPod())
	manager.podIngest = podIngestStoreAdapter{store: store}

	deploymentSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:Deployment:web")
	require.NoError(t, err)

	manager.handleReplicaSetEvent(oldRS, newRS, MessageTypeModified)

	rows := store.List()
	require.Len(t, rows, 1)
	require.Equal(t, "Deployment", rows[0].(ingest.Bundle).Table.(snapshot.PodSummary).OwnerKind)

	deploymentUpdate := requireNextUpdate(t, deploymentSub)
	require.Equal(t, MessageTypeModified, deploymentUpdate.Type)
	require.Equal(t, "web-12345-abcde", deploymentUpdate.Ref.Name)
}

// TestManagerPodSignalReachesDirectOwnerScope: a deployment-owned pod's change
// signal must ring BOTH workload windows — the Deployment scope (collapsed
// owner) and the ReplicaSet scope (direct owner). The RS panel's Pods tab
// subscribes to the latter; deriving scopes only from the collapsed owner left
// it without doorbells.
func TestManagerPodSignalReachesDirectOwnerScope(t *testing.T) {
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
	// Resolved projection (RS known at projection time) delivered through the
	// production notify sink.
	project := snapshot.NewPodIngestProjector(
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		testsupport.NewReplicaSetLister(t, rs),
	)
	store := ingest.NewProjectingStore(project)
	store.SetRetainTable(true)
	store.AddBundleSink(podNotifyBundleSink{manager: manager})

	deploymentSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:Deployment:web")
	require.NoError(t, err)
	rsSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:ReplicaSet:web-12345")
	require.NoError(t, err)

	require.NoError(t, store.Add(racedOwnerPod()))

	deploymentUpdate := requireNextUpdate(t, deploymentSub)
	require.Equal(t, MessageTypeModified, deploymentUpdate.Type)
	require.Equal(t, "web-12345-abcde", deploymentUpdate.Ref.Name)

	rsUpdate := requireNextUpdate(t, rsSub)
	require.Equal(t, MessageTypeModified, rsUpdate.Type)
	require.Equal(t, "web-12345-abcde", rsUpdate.Ref.Name)
}

// TestManagerReplicaSetAddWithoutDeploymentOwnerDoesNotHeal: a standalone RS's
// pods correctly keep the ReplicaSet owner — the fallback scope IS their steady
// state, so the heal must decline and emit nothing.
func TestManagerReplicaSetAddWithoutDeploymentOwnerDoesNotHeal(t *testing.T) {
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Name: "web-12345", Namespace: "default"},
	}
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	store := newRacedPodIngestStore(t, manager, racedOwnerPod())
	manager.podIngest = podIngestStoreAdapter{store: store}

	rsSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:ReplicaSet:web-12345")
	require.NoError(t, err)

	manager.handleReplicaSetEvent(nil, rs, MessageTypeAdded)

	rows := store.List()
	require.Len(t, rows, 1)
	require.Equal(t, "ReplicaSet", rows[0].(ingest.Bundle).Table.(snapshot.PodSummary).OwnerKind)
	select {
	case update := <-rsSub.Updates:
		t.Fatalf("unexpected update on the ReplicaSet scope: %+v", update)
	default:
	}
}

func TestManagerBackpressureTriggersReset(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	update := Update{
		Type:        MessageTypeAdded,
		Domain:      domainPods,
		ClusterID:   "c1",
		ClusterName: "cluster",
		Ref:         refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-1", "")),
	}

	for i := 0; i < config.ResourceStreamSubscriberBufferSize+1; i++ {
		manager.broadcast(domainPods, []string{"namespace:default"}, update)
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

func TestManagerWorkloadUpdateFromPod(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "5",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-12345",
				Controller: ptrBool(true),
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web",
			Namespace:       "default",
			UID:             "deploy-uid",
			ResourceVersion: "9",
		},
	}

	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           applog.Noop,
		deploymentLister: deploymentListerWith(deployment),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainWorkloads, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "web", update.Ref.Name)
		require.Equal(t, "Deployment", update.Ref.Kind)
	default:
		t.Fatal("expected workload update to be delivered")
	}
}

func TestManagerWorkloadUpdateFromCompletedOwnedPod(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "6",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-12345",
				Controller: ptrBool(true),
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodSucceeded},
	}

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web",
			Namespace:       "default",
			UID:             "deploy-uid",
			ResourceVersion: "9",
		},
	}

	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           applog.Noop,
		deploymentLister: deploymentListerWith(deployment),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainWorkloads, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "web", update.Ref.Name)
		require.Equal(t, "Deployment", update.Ref.Kind)
	default:
		t.Fatal("expected completed owned pod to refresh workload row")
	}
}

func TestManagerDeletesStandaloneWorkloadRowWhenPodCompletes(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "7",
		},
		Status: corev1.PodStatus{Phase: corev1.PodFailed},
	}

	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeDeleted, update.Type)
		require.Equal(t, domainWorkloads, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "pod-1", update.Ref.Name)
		require.Equal(t, "Pod", update.Ref.Kind)
	default:
		t.Fatal("expected completed standalone pod to delete workload row")
	}
}

func TestManagerNodeUpdateFromPod(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		nodeLister: nodeListerWith(&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "node-a",
				UID:             "node-uid",
				ResourceVersion: "7",
			},
		}),
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNodes, "")
	require.NoError(t, err)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "5",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-a",
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}

	// Ensure pod changes refresh node summaries via the pod-based handler.
	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainNodes, update.Domain)
		require.Equal(t, "node-a", update.Ref.Name)
		require.Equal(t, "Node", update.Ref.Kind)
		// nodes is query-backed: the change signal carries no row.
	default:
		t.Fatal("expected node update to be delivered")
	}
}

func nodeListerWith(nodes ...*corev1.Node) corelisters.NodeLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, node := range nodes {
		_ = indexer.Add(node)
	}
	return corelisters.NewNodeLister(indexer)
}

func deploymentListerWith(items ...*appsv1.Deployment) appslisters.DeploymentLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		cache.NamespaceIndex: cache.MetaNamespaceIndexFunc,
	})
	for _, item := range items {
		_ = indexer.Add(item)
	}
	return appslisters.NewDeploymentLister(indexer)
}

func customResourceDefinition(
	name string,
	group string,
	plural string,
	kind string,
	scope apiextensionsv1.ResourceScope,
	resourceVersion string,
) *apiextensionsv1.CustomResourceDefinition {
	return &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: resourceVersion},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: group,
			Scope: scope,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: plural,
				Kind:   kind,
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}
}

func ptrBool(value bool) *bool {
	return &value
}
