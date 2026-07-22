package objectcatalog

import (
	"context"
	"fmt"
	stdruntime "runtime"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
)

func BenchmarkCatalogIndexResidency(b *testing.B) {
	for _, size := range []int{100000, 250000} {
		b.Run(fmt.Sprintf("single-cluster-%d", size), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				bytes := measureCatalogIndexResidency(size, 1)
				b.ReportMetric(float64(bytes)/(1024*1024), "resident_mb")
			}
		})
	}
	b.Run("multi-cluster-3x100000", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			bytes := measureCatalogIndexResidency(100000, 3)
			b.ReportMetric(float64(bytes)/(1024*1024), "resident_mb")
		}
	})
}

func BenchmarkCatalogQueryPages(b *testing.B) {
	for _, size := range []int{10000, 50000, 100000, 250000} {
		b.Run(fmt.Sprintf("empty-search-%d", size), func(b *testing.B) {
			svc := benchmarkCatalogService(size)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				result := svc.Query(QueryOptions{Limit: 100})
				if len(result.Items) != 100 {
					b.Fatalf("expected 100 items, got %d", len(result.Items))
				}
			}
		})
		b.Run(fmt.Sprintf("namespace-filter-%d", size), func(b *testing.B) {
			svc := benchmarkCatalogService(size)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				result := svc.Query(QueryOptions{Limit: 100, Namespaces: []string{"team-0001"}})
				if len(result.Items) == 0 {
					b.Fatalf("expected namespace-filtered items")
				}
			}
		})
		b.Run(fmt.Sprintf("cursor-page-%d", size), func(b *testing.B) {
			svc := benchmarkCatalogService(size)
			first := svc.Query(QueryOptions{Limit: 100})
			if first.ContinueToken == "" {
				b.Fatalf("expected continue token")
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				result := svc.Query(QueryOptions{Limit: 100, Continue: first.ContinueToken})
				if len(result.Items) != 100 {
					b.Fatalf("expected 100 items, got %d", len(result.Items))
				}
			}
		})
	}
}

func BenchmarkCatalogQueryPathologicalFixtures(b *testing.B) {
	for _, fixture := range []struct {
		name    string
		objects int
		shape   benchmarkCatalogShape
		query   QueryOptions
	}{
		{
			name:    "many-namespaces",
			objects: 50000,
			shape:   benchmarkShapeManyNamespaces,
			query:   QueryOptions{Limit: 100, Namespaces: []string{"team-0042"}},
		},
		{
			name:    "one-namespace-dominates",
			objects: 50000,
			shape:   benchmarkShapeOneNamespaceDominates,
			query:   QueryOptions{Limit: 100, Namespaces: []string{"hot-team"}},
		},
		{
			name:    "many-kinds",
			objects: 50000,
			shape:   benchmarkShapeManyKinds,
			query:   QueryOptions{Limit: 100, Kinds: []string{"example.io/v1/Widget042"}},
		},
		{
			name:    "long-names-missing-metadata",
			objects: 50000,
			shape:   benchmarkShapeLongNamesMissingMetadata,
			query:   QueryOptions{Limit: 100, Search: "target"},
		},
	} {
		b.Run(fixture.name, func(b *testing.B) {
			svc := benchmarkCatalogServiceWithShape(fixture.objects, fixture.shape)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				result := svc.Query(fixture.query)
				if len(result.Items) == 0 {
					b.Fatalf("expected matching items for %s", fixture.name)
				}
			}
		})
	}
}

func BenchmarkCatalogQueryChurnDuringPagination(b *testing.B) {
	for _, size := range []int{10000, 100000} {
		b.Run(fmt.Sprintf("live-insert-before-anchor-%d", size), func(b *testing.B) {
			svc := benchmarkCatalogService(size)
			first := svc.Query(QueryOptions{Limit: 100})
			if first.ContinueToken == "" {
				b.Fatalf("expected continue token")
			}
			desc := resourceDescriptor{
				GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
				Namespaced: true,
				Kind:       "Deployment",
				Group:      "apps",
				Version:    "v1",
				Resource:   "deployments",
				Scope:      ScopeNamespace,
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				b.StopTimer()
				items := cloneSummaryMap(svc.items)
				name := fmt.Sprintf("deploy-before-anchor-%06d", i)
				items[catalogKey(desc, "team-0000", name)] = Summary{Ref: resourcemodel.ResourceRef{ClusterID: svc.clusterID, Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: "team-0000", Name: name, UID: fmt.Sprintf("uid-churn-%d", i)},

					ResourceVersion:   fmt.Sprintf("rv-churn-%d", i),
					CreationTimestamp: "2025-12-31T00:00:00Z",
					Scope:             ScopeNamespace,
				}
				svc.catalogIndex.rebuildCacheFromItems(items, []Descriptor{exportDescriptor(desc)})
				b.StartTimer()
				result := svc.Query(QueryOptions{Limit: 100, Continue: first.ContinueToken})
				if result.CursorInvalid || len(result.Items) == 0 {
					b.Fatalf("expected cursor continuity after churn, got invalid=%v len=%d", result.CursorInvalid, len(result.Items))
				}
			}
		})
	}
}

// BenchmarkCatalogPublish measures the cost of a single watch-flush publish
// (full cache rebuild from items) — this runs on every coalesced watch flush
// (200ms under churn) whether or not anything queries the catalog.
func BenchmarkCatalogPublish(b *testing.B) {
	for _, size := range []int{10000, 100000} {
		b.Run(fmt.Sprintf("rebuild-%d", size), func(b *testing.B) {
			svc := benchmarkCatalogService(size)
			items := cloneSummaryMap(svc.items)
			descriptors := svc.catalogIndex.descriptors()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				svc.catalogIndex.rebuildCacheFromItems(items, descriptors)
			}
		})
	}
}

func measureCatalogIndexResidency(objectsPerCluster, clusterCount int) uint64 {
	stdruntime.GC()
	var before stdruntime.MemStats
	stdruntime.ReadMemStats(&before)

	services := make([]*Service, 0, clusterCount)
	for clusterIdx := 0; clusterIdx < clusterCount; clusterIdx++ {
		svc := NewService(Dependencies{
			ClusterID:   fmt.Sprintf("cluster-%d", clusterIdx),
			ClusterName: fmt.Sprintf("Cluster %d", clusterIdx),
		}, nil)
		items := make(map[string]Summary, objectsPerCluster)
		desc := resourceDescriptor{
			GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
			Namespaced: true,
			Kind:       "Deployment",
			Group:      "apps",
			Version:    "v1",
			Resource:   "deployments",
			Scope:      ScopeNamespace,
		}
		for i := 0; i < objectsPerCluster; i++ {
			namespace := fmt.Sprintf("team-%04d", i%1000)
			name := fmt.Sprintf("deploy-%06d", i)
			items[catalogKey(desc, namespace, name)] = Summary{Ref: resourcemodel.ResourceRef{ClusterID: svc.clusterID, Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: namespace, Name: name, UID: fmt.Sprintf("uid-%d-%d", clusterIdx, i)},

				ResourceVersion:   fmt.Sprintf("%d", i),
				CreationTimestamp: "2026-01-01T00:00:00Z",
				Scope:             ScopeNamespace,
			}
		}
		svc.catalogIndex.rebuildCacheFromItems(items, []Descriptor{exportDescriptor(desc)})
		services = append(services, svc)
	}

	stdruntime.GC()
	var after stdruntime.MemStats
	stdruntime.ReadMemStats(&after)
	stdruntime.KeepAlive(services)
	if after.Alloc < before.Alloc {
		return 0
	}
	return after.Alloc - before.Alloc
}

type benchmarkCatalogShape int

const (
	benchmarkShapeDefault benchmarkCatalogShape = iota
	benchmarkShapeManyNamespaces
	benchmarkShapeOneNamespaceDominates
	benchmarkShapeManyKinds
	benchmarkShapeLongNamesMissingMetadata
)

func benchmarkCatalogService(objects int) *Service {
	return benchmarkCatalogServiceWithShape(objects, benchmarkShapeDefault)
}

func benchmarkCatalogServiceWithShape(objects int, shape benchmarkCatalogShape) *Service {
	svc := NewService(Dependencies{
		ClusterID:   "cluster-benchmark",
		ClusterName: "Benchmark",
	}, nil)
	items := make(map[string]Summary, objects)
	descriptorsByKey := make(map[string]resourceDescriptor)
	for i := 0; i < objects; i++ {
		desc := benchmarkDescriptorForObject(i, shape)
		namespace := benchmarkNamespaceForObject(i, objects, shape)
		name := benchmarkNameForObject(i, shape)
		items[catalogKey(desc, namespace, name)] = Summary{Ref: resourcemodel.ResourceRef{ClusterID: svc.clusterID, Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: namespace, Name: name, UID: fmt.Sprintf("uid-%d", i)},

			ResourceVersion:   fmt.Sprintf("%d", i),
			CreationTimestamp: "2026-01-01T00:00:00Z",
			Scope:             ScopeNamespace,
		}
		descriptorsByKey[desc.GVR.String()] = desc
	}
	descriptors := make([]Descriptor, 0, len(descriptorsByKey))
	for _, desc := range descriptorsByKey {
		descriptors = append(descriptors, exportDescriptor(desc))
	}
	// Mirror the real sync flow (sync.go), which stores the item map AND
	// rebuilds the cache. Benchmarks that clone svc.items rely on this.
	svc.items = items
	svc.catalogIndex.rebuildCacheFromItems(items, descriptors)
	return svc
}

func benchmarkDescriptorForObject(index int, shape benchmarkCatalogShape) resourceDescriptor {
	if shape == benchmarkShapeManyKinds {
		kindIndex := index % 100
		kind := fmt.Sprintf("Widget%03d", kindIndex)
		resource := fmt.Sprintf("widgets%03d", kindIndex)
		return resourceDescriptor{
			GVR:        schema.GroupVersionResource{Group: "example.io", Version: "v1", Resource: resource},
			Namespaced: true,
			Kind:       kind,
			Group:      "example.io",
			Version:    "v1",
			Resource:   resource,
			Scope:      ScopeNamespace,
		}
	}
	return resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
}

func benchmarkNamespaceForObject(index, total int, shape benchmarkCatalogShape) string {
	switch shape {
	case benchmarkShapeManyNamespaces:
		return fmt.Sprintf("team-%04d", index%5000)
	case benchmarkShapeOneNamespaceDominates:
		if index < (total*9)/10 {
			return "hot-team"
		}
		return fmt.Sprintf("team-%04d", index%1000)
	default:
		return fmt.Sprintf("team-%04d", index%1000)
	}
}

func benchmarkNameForObject(index int, shape benchmarkCatalogShape) string {
	if shape == benchmarkShapeLongNamesMissingMetadata {
		if index%257 == 0 {
			return fmt.Sprintf("target-%024d-%024d-%024d", index, index, index)
		}
		return fmt.Sprintf("very-long-resource-name-%024d-%024d-%024d", index, index, index)
	}
	return fmt.Sprintf("deploy-%06d", index)
}

func BenchmarkServiceSyncLargeCluster(b *testing.B) {
	scheme := runtime.NewScheme()
	workloadGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(workloadGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(workloadGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}

	seedObjects := make([]runtime.Object, 0, 1000)
	for nsIdx := 0; nsIdx < 50; nsIdx++ {
		namespace := fmt.Sprintf("team-%03d", nsIdx)
		for objIdx := 0; objIdx < 200; objIdx++ {
			obj := &unstructured.Unstructured{}
			obj.SetGroupVersionKind(workloadGVK)
			obj.SetNamespace(namespace)
			obj.SetName(fmt.Sprintf("deploy-%03d", objIdx))
			seedObjects = append(seedObjects, obj)
		}
	}

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, seedObjects...)

	client := kubernetesfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Namespaced: true, Kind: "Deployment", Verbs: []string{"list"}},
			},
		},
	}

	deps := Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			DynamicClient:    dyn,
		},
	}

	svc := NewService(deps, &Options{PageSize: 200, ListWorkers: 16, NamespaceWorkers: 16})

	if err := svc.sync(context.Background()); err != nil {
		b.Fatalf("warmup sync failed: %v", err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := svc.sync(context.Background()); err != nil {
			b.Fatalf("sync failed: %v", err)
		}
	}
}
