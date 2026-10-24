package objectcatalog

import (
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// A small live change must publish query rows, identity, facets and Attention
// findings without rebuilding every unchanged object in a large catalog.
func TestIncrementalCatalogPublication(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)
	svc.catalogIndex.rebuildCacheFromItems(svc.items, []Descriptor{desc})
	baseline := svc.cacheRebuilds.Load()
	updates, unsubscribe := svc.SubscribeStreaming()
	defer unsubscribe()
	<-updates
	obj := &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
		Name: "sample", Namespace: "team-a", UID: "original", ResourceVersion: "1",
	}}
	apply := func(deleted bool) {
		svc.applyIngestCatalogSummary(desc.GVR(), svc.buildSummary(desc, obj), deleted)
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
	svc.publishSyncedAttentionSubsets(map[string]Summary{"deleting": row})
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
