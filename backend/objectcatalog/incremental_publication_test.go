package objectcatalog

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// A small live change must publish query rows, identity, facets and Attention
// findings without rebuilding every unchanged object in a large catalog.
func TestIncrementalCatalogPublication(t *testing.T) {
	for _, source := range []string{"watch", "ingest"} {
		t.Run(source, func(t *testing.T) {
			svc := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
			desc := testDeploymentDescriptor()
			registerDesc(svc, desc)
			svc.catalogIndex.rebuildCacheFromItems(svc.items, []Descriptor{desc})
			baseline := svc.cacheRebuilds.Load()
			updates, unsubscribe := svc.SubscribeStreaming()
			defer unsubscribe()
			<-updates
			notifier := newWatchNotifier(svc)
			obj := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
				Name: "sample", Namespace: "team-a", UID: "original", ResourceVersion: "1",
			}}
			apply := func(deleted bool) {
				if source == "ingest" {
					svc.applyIngestCatalogSummary(desc.GVR(), svc.buildSummary(desc, obj), deleted)
				} else {
					event := watchEvent{eventType: watchEventUpdate, gvr: desc.GVR().String(), key: catalogKey(desc, obj.Namespace, obj.Name), obj: obj}
					if deleted {
						event.eventType = watchEventDelete
					}
					notifier.flush([]watchEvent{event})
				}
				select {
				case <-updates:
				case <-time.After(time.Second):
					t.Fatal("catalog change did not publish a signal")
				}
			}
			apply(false)
			require.Equal(t, 1, svc.Query(QueryOptions{}).TotalItems)
			require.Equal(t, []string{"team-a"}, svc.Namespaces())
			obj.UID = "replacement"
			obj.ResourceVersion = "2"
			obj.DeletionTimestamp = &metav1.Time{Time: time.Unix(100, 0)}
			obj.Finalizers = []string{"example.com/cleanup"}
			apply(false)
			result := svc.Query(QueryOptions{})
			require.Equal(t, 1, result.TotalItems, "recreation must replace the previous query row")
			require.Equal(t, "replacement", result.Items[0].Ref.UID)
			_, found := svc.FindByUID("original")
			require.False(t, found, "old UID must not resolve to its replacement")
			require.Equal(t, []FinalizerBlocker{{Ref: result.Items[0].Ref, Metadata: result.Items[0].Metadata, DeletionTimestamp: 100000}}, svc.FinalizerBlockers())
			apply(true)
			require.Zero(t, svc.Query(QueryOptions{}).TotalItems)
			require.Empty(t, svc.Namespaces())
			require.Empty(t, svc.Query(QueryOptions{}).Kinds)
			require.Empty(t, svc.FinalizerBlockers())
			_, found = svc.FindExactMatch("team-a", "apps", "v1", "Deployment", "sample")
			require.False(t, found)
			require.Equal(t, baseline, svc.cacheRebuilds.Load(), "live changes must not rebuild the full catalog")
		})
	}
}

func TestIncrementalQueriesMatchFullPublication(t *testing.T) {
	rows := generateOracleObjects(rand.New(rand.NewSource(42)), 80)
	svc := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	for _, row := range rows {
		desc := Descriptor{Group: row.Ref.Group, Version: row.Ref.Version, Kind: row.Ref.Kind, Resource: row.Ref.Resource, Namespaced: row.Scope == ScopeNamespace, Scope: row.Scope}
		registerDesc(svc, desc)
		svc.items[catalogKey(desc, row.Ref.Namespace, row.Ref.Name)] = row
	}
	svc.catalogIndex.rebuildCacheFromItems(svc.items, svc.Descriptors())
	baseline := svc.cacheRebuilds.Load()
	for i, row := range rows[:12] {
		row.Ref.UID += "-replacement"
		row.ResourceVersion = "updated"
		gvr := schema.GroupVersionResource{Group: row.Ref.Group, Version: row.Ref.Version, Resource: row.Ref.Resource}
		if i%3 == 0 {
			svc.replaceIngestCatalogSummaries(gvr, []Summary{row})
		} else {
			svc.applyIngestCatalogSummary(gvr, row, i%3 == 1)
		}
		want := newEquivalenceService(t, svc.Snapshot())
		want.clusterID = svc.clusterID
		want.cachedDescriptors = svc.Descriptors()
		for _, query := range []QueryOptions{
			{Limit: 5}, {Limit: 100, SortField: "name", SortDirection: "desc"},
			{Limit: 100, Namespaces: []string{"default"}}, {Limit: 100, Kinds: []string{"Pod"}},
			{Limit: 100, CustomOnly: true}, {Limit: 100, Search: "alpha"},
		} {
			require.Equal(t, want.Query(query), svc.Query(query), "query after incremental change %d: %+v", i, query)
		}
	}
	require.Equal(t, baseline, svc.cacheRebuilds.Load())
}

func TestCatalogQueryReadsOnePublication(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)
	row := Summary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "team-a", Name: "first", UID: "first"}, Scope: ScopeNamespace}
	svc.replaceIngestCatalogSummaries(desc.GVR(), []Summary{row})
	other := row
	other.Ref.Name, other.Ref.UID, other.Ref.Namespace = "second", "second", "team-b"
	var workers sync.WaitGroup
	workers.Go(func() {
		for range 200 {
			svc.replaceIngestCatalogSummaries(desc.GVR(), []Summary{row, other})
			svc.replaceIngestCatalogSummaries(desc.GVR(), []Summary{row})
		}
	})
	defer workers.Wait()
	for range 200 {
		page := svc.Query(QueryOptions{Limit: 10})
		require.Equal(t, len(page.Items), page.TotalItems)
		require.Equal(t, page.TotalItems, page.UnfilteredTotal)
		require.Len(t, page.Namespaces, page.TotalItems, "each published object occupies a different namespace")
	}
}

func TestSourceReplayPublishesWatchChangesBeforeSignaling(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	desc := Descriptor{Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets", Scope: ScopeNamespace, Namespaced: true}
	registerDesc(svc, desc)
	updates, unsubscribe := svc.SubscribeStreaming()
	defer unsubscribe()
	<-updates
	notifier := newWatchNotifier(svc)
	obj := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Name: "during-replay", Namespace: "team-a", UID: "new"}}
	var once sync.Once
	svc.deps.IngestSource = replayIngestSource{afterReplay: func() {
		once.Do(func() {
			notifier.flush([]watchEvent{{eventType: watchEventAdd, gvr: desc.GVR().String(), key: catalogKey(desc, obj.Namespace, obj.Name), obj: obj}})
		})
		select {
		case <-updates:
			t.Fatal("source replay signaled before publishing the complete query baseline")
		default:
		}
	}}
	svc.registerIngestCatalogSinks()
	select {
	case <-updates:
	case <-time.After(time.Second):
		t.Fatal("source replay did not publish its completion")
	}
	page := svc.Query(QueryOptions{})
	require.Equal(t, 1, page.TotalItems)
	require.Equal(t, "new", page.Items[0].Ref.UID)
	require.Equal(t, []string{"team-a"}, page.Namespaces)
}

func TestIngestReplacementDoesNotRepublishUnchangedFinalizers(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)
	obj := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
		Name: "deleting", Namespace: "team-a", UID: "blocked",
		DeletionTimestamp: &metav1.Time{Time: time.Unix(100, 0)}, Finalizers: []string{"example.com/cleanup"},
	}}
	row := svc.buildSummary(desc, obj)
	svc.applyIngestCatalogSummary(desc.GVR(), row, false)
	updates, unsubscribe := svc.SubscribeFinalizerBlockers()
	defer unsubscribe()
	<-updates
	svc.replaceIngestCatalogSummaries(desc.GVR(), []Summary{row})
	require.Len(t, svc.FinalizerBlockers(), 1)
	select {
	case <-updates:
		t.Fatal("unchanged finalizer findings triggered another Attention update")
	default:
	}
	svc.replaceIngestCatalogSummaries(desc.GVR(), nil)
	select {
	case <-updates:
	case <-time.After(time.Second):
		t.Fatal("completed deletion did not remove the Attention finding")
	}
	require.Empty(t, svc.FinalizerBlockers())
}

func TestWatchChangeDuringFullSyncConverges(t *testing.T) {
	desc := Descriptor{Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets", Scope: ScopeNamespace, Namespaced: true}
	client := kubernetesfake.NewClientset()
	discovery := &preferredDiscovery{FakeDiscovery: client.Discovery().(*fakediscovery.FakeDiscovery), resources: []*metav1.APIResourceList{{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: metav1.Verbs{"list"}}}}}}
	latest := &unstructured.Unstructured{}
	latest.SetAPIVersion("example.com/v1")
	latest.SetKind("Widget")
	latest.SetName("changed-during-sync")
	latest.SetNamespace("team-a")
	latest.SetUID("current")
	latest.SetResourceVersion("2")
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{desc.GVR(): "WidgetList"}, latest)
	svc := NewService(Dependencies{ClusterID: "cluster-a", Common: common.Dependencies{KubernetesClient: &discoveryOverrideClient{Clientset: client, discovery: discovery}, DynamicClient: dyn}}, nil)
	notifier := newWatchNotifier(svc)
	first := true
	dyn.PrependReactor("list", "widgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if !first {
			return false, nil, nil
		}
		first = false
		// The watch is ahead of the LIST while sync owns publication. Recovery
		// must reread the source after that stale collection has published.
		notifier.flush([]watchEvent{{eventType: watchEventAdd, gvr: desc.GVR().String(), key: catalogKey(desc, latest.GetNamespace(), latest.GetName()), obj: latest}})
		return true, &unstructured.UnstructuredList{}, nil
	})
	require.NoError(t, svc.sync(context.Background()))
	notifier.runRecoverySync(context.Background())
	page := svc.Query(QueryOptions{})
	require.Equal(t, 1, page.TotalItems)
	require.Equal(t, "2", page.Items[0].ResourceVersion)
	require.Equal(t, []string{"team-a"}, page.Namespaces)
}

func BenchmarkCatalogIncrementalPublication(b *testing.B) {
	for _, size := range []int{10000, 100000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			svc := benchmarkCatalogService(size)
			desc := testDeploymentDescriptor()
			registerDesc(svc, desc)
			row := Summary{Ref: resourcemodel.ResourceRef{ClusterID: svc.clusterID, Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: "team-0000", Name: "deploy-000000", UID: "uid-0"}, Scope: ScopeNamespace}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				svc.applyIngestCatalogSummary(desc.GVR(), row, false)
			}
		})
	}
}
