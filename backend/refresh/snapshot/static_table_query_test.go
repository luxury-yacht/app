package snapshot

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"strconv"
	"testing"
)

func migratedStaticQuery() typedTableQuery {
	return typedTableQuery{
		Enabled:   true,
		BaseScope: "namespace:all",
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "test",
			Search:        "team-a",
			SortField:     "namespace",
			SortDirection: "asc",
			Limit:         1,
		},
	}
}

func assertMigratedPage[T any](t *testing.T, page typedTableQueryPage[T]) {
	t.Helper()
	if len(page.Rows) != 1 {
		t.Fatalf("len(page.Rows)=%d, want 1", len(page.Rows))
	}
	if page.Total != 2 {
		t.Fatalf("page.Total=%d, want 2", page.Total)
	}
	if !page.TotalIsExact || !page.FacetsExact {
		t.Fatalf("exact flags total=%v facets=%v, want true/true", page.TotalIsExact, page.FacetsExact)
	}
	if page.Continue == "" {
		t.Fatalf("page.Continue is empty, want cursor for second matching row")
	}
}

func TestMigratedNamespaceStaticTableAdaptersQueryAndPage(t *testing.T) {
	query := migratedStaticQuery()

	t.Run("config", func(t *testing.T) {
		page := applyTypedTableQuery([]ConfigSummary{
			{Ref: testCanonicalRowRef("ConfigMap", "team-a", "alpha"), Data: 2},
			{Ref: testCanonicalRowRef("Secret", "team-a", "bravo"), TypeAlias: "Opaque"},
			{Ref: testCanonicalRowRef("Secret", "team-b", "charlie")},
		}, query, configTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("network", func(t *testing.T) {
		page := applyTypedTableQuery([]NetworkSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "Service", Namespace: "team-a", Name: "alpha"}, Details: "ClusterIP"},
			{Ref: resourcemodel.ResourceRef{Kind: "Ingress", Namespace: "team-a", Name: "bravo"}, Details: "host"},
			{Ref: resourcemodel.ResourceRef{Kind: "Service", Namespace: "team-b", Name: "charlie"}},
		}, query, networkTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("storage", func(t *testing.T) {
		page := applyTypedTableQuery([]StorageSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolumeClaim", Namespace: "team-a", Name: "alpha"}, Status: "Bound"},
			{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolumeClaim", Namespace: "team-a", Name: "bravo"}, StorageClass: "fast"},
			{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolumeClaim", Namespace: "team-b", Name: "charlie"}},
		}, query, storageTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("autoscaling", func(t *testing.T) {
		page := applyTypedTableQuery([]AutoscalingSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "HorizontalPodAutoscaler", Namespace: "team-a", Name: "alpha"}, Target: "Deployment/api", Current: 2},
			{Ref: resourcemodel.ResourceRef{Kind: "HorizontalPodAutoscaler", Namespace: "team-a", Name: "bravo"}, Target: "Deployment/web", Current: 3},
			{Ref: resourcemodel.ResourceRef{Kind: "HorizontalPodAutoscaler", Namespace: "team-b", Name: "charlie"}},
		}, query, autoscalingTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("quotas", func(t *testing.T) {
		page := applyTypedTableQuery([]QuotaSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "ResourceQuota", Namespace: "team-a", Name: "alpha"}, Details: "Hard: 2"},
			{Ref: resourcemodel.ResourceRef{Kind: "LimitRange", Namespace: "team-a", Name: "bravo"}, Details: "Limits: 1"},
			{Ref: resourcemodel.ResourceRef{Kind: "PodDisruptionBudget", Namespace: "team-b", Name: "charlie"}},
		}, query, quotaTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("rbac", func(t *testing.T) {
		page := applyTypedTableQuery([]RBACSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "Role", Namespace: "team-a", Name: "alpha"}, Details: "Rules: 1"},
			{Ref: resourcemodel.ResourceRef{Kind: "RoleBinding", Namespace: "team-a", Name: "bravo"}, Details: "Role: admin"},
			{Ref: resourcemodel.ResourceRef{Kind: "ServiceAccount", Namespace: "team-b", Name: "charlie"}},
		}, query, rbacTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("helm", func(t *testing.T) {
		page := applyTypedTableQuery([]NamespaceHelmSummary{
			{Ref: resourcemodel.ResourceRef{Namespace: "team-a", Name: "alpha"}, Chart: "api", Revision: 1},
			{Ref: resourcemodel.ResourceRef{Namespace: "team-a", Name: "bravo"}, Chart: "web", Revision: 2},
			{Ref: resourcemodel.ResourceRef{Namespace: "team-b", Name: "charlie"}},
		}, query, helmTableQueryAdapter())
		assertMigratedPage(t, page)
	})
}

func TestMigratedClusterStaticTableAdaptersQueryAndPage(t *testing.T) {
	query := migratedStaticQuery()
	query.BaseScope = ""
	query.Request.Search = "alpha"
	query.Request.SortField = "name"
	query.Request.Limit = 1

	t.Run("config", func(t *testing.T) {
		page := applyTypedTableQuery([]ClusterConfigEntry{
			{Ref: testCanonicalRowRef("StorageClass", "", "alpha-a")},
			{Ref: testCanonicalRowRef("IngressClass", "", "alpha-b")},
			{Ref: testCanonicalRowRef("GatewayClass", "", "charlie")},
		}, query, clusterConfigTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("storage", func(t *testing.T) {
		page := applyTypedTableQuery([]ClusterStorageEntry{
			{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolume", Name: "alpha-a"}, Status: "Bound"},
			{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolume", Name: "alpha-b"}, StorageClass: "fast"},
			{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolume", Name: "charlie"}},
		}, query, clusterStorageTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("rbac", func(t *testing.T) {
		page := applyTypedTableQuery([]ClusterRBACEntry{
			{Ref: resourcemodel.ResourceRef{Kind: "ClusterRole", Name: "alpha-a"}},
			{Ref: resourcemodel.ResourceRef{Kind: "ClusterRoleBinding", Name: "alpha-b"}},
			{Ref: resourcemodel.ResourceRef{Kind: "ClusterRole", Name: "charlie"}},
		}, query, clusterRBACTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("crds", func(t *testing.T) {
		page := applyTypedTableQuery([]ClusterCRDEntry{
			{Ref: resourcemodel.ResourceRef{Kind: "Widget", Name: "alpha-a.example.com"}, Group: "example.com"},
			{Ref: resourcemodel.ResourceRef{Kind: "Widget", Name: "alpha-b.example.com"}, Group: "example.com"},
			{Ref: resourcemodel.ResourceRef{Kind: "Gadget", Name: "charlie.example.com"}, Group: "example.com"},
		}, query, clusterCRDTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("nodes", func(t *testing.T) {
		page := applyTypedTableQuery([]NodeSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "alpha-a"}, CPUUsage: "100m"},
			{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "alpha-b"}, CPUUsage: "200m"},
			{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "charlie"}, CPUUsage: "300m"},
		}, query, nodeTableQueryAdapter())
		assertMigratedPage(t, page)
	})
}

func TestNodeTableQuerySortsAgeByTimestamp(t *testing.T) {
	query := typedTableQuery{
		Enabled:   true,
		BaseScope: "cluster",
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "nodes",
			SortField:     "age",
			SortDirection: "asc",
			Limit:         10,
		},
	}

	page := applyTypedTableQuery([]NodeSummary{
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "old-node"}, Age: "10d", AgeTimestamp: 1_700_000_000_000},
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "young-node"}, Age: "2h", AgeTimestamp: 1_700_856_000_000},
	}, query, nodeTableQueryAdapter())

	if len(page.Rows) != 2 {
		t.Fatalf("len(page.Rows)=%d, want 2", len(page.Rows))
	}
	if page.Rows[0].Ref.Name != "young-node" {
		t.Fatalf("first node=%q, want young-node", page.Rows[0].Ref.Name)
	}

	query.Request.SortDirection = "desc"
	page = applyTypedTableQuery([]NodeSummary{
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "old-node"}, Age: "10d", AgeTimestamp: 1_700_000_000_000},
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "young-node"}, Age: "2h", AgeTimestamp: 1_700_856_000_000},
	}, query, nodeTableQueryAdapter())

	if page.Rows[0].Ref.Name != "old-node" {
		t.Fatalf("first node=%q, want old-node", page.Rows[0].Ref.Name)
	}
}

func TestNodeTableQueryMetadataSearch(t *testing.T) {
	nodes := []NodeSummary{
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "node-a"}, Labels: map[string]string{"team": "payments"}},
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "node-b"}, Annotations: map[string]string{"owner": "search-team"}},
	}
	base := typedTableQuery{
		Enabled:   true,
		BaseScope: "cluster",
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "nodes",
			SortField:     "name",
			SortDirection: "asc",
			Limit:         10,
			Search:        "payments",
		},
	}

	// Without IncludeMetadata, a label value is not part of the searchable text.
	page := applyTypedTableQuery(nodes, base, nodeTableQueryAdapter())
	if len(page.Rows) != 0 {
		t.Fatalf("without IncludeMetadata: matched %d rows, want 0", len(page.Rows))
	}

	// With IncludeMetadata, the search also matches labels.
	withMeta := base
	withMeta.Request.IncludeMetadata = true
	page = applyTypedTableQuery(nodes, withMeta, nodeTableQueryAdapter())
	if len(page.Rows) != 1 || page.Rows[0].Ref.Name != "node-a" {
		t.Fatalf("label search with IncludeMetadata: got %d rows %v, want 1 (node-a)", len(page.Rows), page.Rows)
	}

	// Annotations are searchable too (key or value).
	withMeta.Request.Search = "search-team"
	page = applyTypedTableQuery(nodes, withMeta, nodeTableQueryAdapter())
	if len(page.Rows) != 1 || page.Rows[0].Ref.Name != "node-b" {
		t.Fatalf("annotation search with IncludeMetadata: got %d rows %v, want 1 (node-b)", len(page.Rows), page.Rows)
	}
}

func TestNodeTableQueryPaginatesAgeSort(t *testing.T) {
	query := typedTableQuery{
		Enabled:   true,
		BaseScope: "cluster",
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "nodes",
			SortField:     "age",
			SortDirection: "asc",
			Limit:         1,
		},
	}
	rows := []NodeSummary{
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "old-node"}, Age: "10d", AgeTimestamp: 1_700_000_000_000},
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "middle-node"}, Age: "2d", AgeTimestamp: 1_700_691_200_000},
		{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: "young-node"}, Age: "2h", AgeTimestamp: 1_700_856_000_000},
	}

	page := applyTypedTableQuery(rows, query, nodeTableQueryAdapter())
	requireNodePageNames(t, page, []string{"young-node"})
	if page.Continue == "" {
		t.Fatalf("first page Continue is empty, want cursor for middle-node")
	}

	query.Request.Continue = page.Continue
	page = applyTypedTableQuery(rows, query, nodeTableQueryAdapter())
	requireNodePageNames(t, page, []string{"middle-node"})
	if page.Continue == "" {
		t.Fatalf("second page Continue is empty, want cursor for old-node")
	}

	query.Request.Continue = page.Continue
	page = applyTypedTableQuery(rows, query, nodeTableQueryAdapter())
	requireNodePageNames(t, page, []string{"old-node"})
	if page.Continue != "" {
		t.Fatalf("third page Continue=%q, want empty", page.Continue)
	}
}

func TestStaticTableQuerySortsFrontendColumnKeys(t *testing.T) {
	query := typedTableQuery{
		Enabled:   true,
		BaseScope: "cluster",
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "test",
			SortDirection: "asc",
			Limit:         10,
		},
	}

	t.Run("cluster crd version column", func(t *testing.T) {
		query.Request.SortField = "version"
		page := applyTypedTableQuery([]ClusterCRDEntry{
			{Ref: resourcemodel.ResourceRef{Name: "widgets.example.com"}, StorageVersion: "v2"},
			{Ref: resourcemodel.ResourceRef{Name: "gadgets.example.com"}, StorageVersion: "v1"},
		}, query, clusterCRDTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"gadgets.example.com", "widgets.example.com"}, func(row ClusterCRDEntry) string {
			return row.Ref.Name
		})
	})

	t.Run("cluster storage access modes column", func(t *testing.T) {
		query.Request.SortField = "accessModes"
		page := applyTypedTableQuery([]ClusterStorageEntry{
			{Ref: resourcemodel.ResourceRef{Name: "pv-read-write-many"}, AccessModes: "ReadWriteMany"},
			{Ref: resourcemodel.ResourceRef{Name: "pv-read-only-many"}, AccessModes: "ReadOnlyMany"},
		}, query, clusterStorageTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"pv-read-only-many", "pv-read-write-many"}, func(row ClusterStorageEntry) string {
			return row.Ref.Name
		})
	})

	t.Run("cluster event object columns", func(t *testing.T) {
		query.Request.SortField = "objectType"
		page := applyTypedTableQuery([]ClusterEventEntry{
			{Ref: resourcemodel.ResourceRef{Name: "event-pod"}, Object: "Pod/api"},
			{Ref: resourcemodel.ResourceRef{Name: "event-deployment"}, Object: "Deployment/web"},
		}, query, clusterEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-deployment", "event-pod"}, func(row ClusterEventEntry) string {
			return row.Ref.Name
		})

		query.Request.SortField = "objectName"
		page = applyTypedTableQuery([]ClusterEventEntry{
			{Ref: resourcemodel.ResourceRef{Name: "event-zulu"}, Object: "Pod/zulu"},
			{Ref: resourcemodel.ResourceRef{Name: "event-alpha"}, Object: "Pod/alpha"},
		}, query, clusterEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-alpha", "event-zulu"}, func(row ClusterEventEntry) string {
			return row.Ref.Name
		})
	})

	t.Run("node pods column", func(t *testing.T) {
		query.BaseScope = "cluster"
		query.Request.SortField = "pods"
		page := applyTypedTableQuery([]NodeSummary{
			{Ref: resourcemodel.ResourceRef{Name: "busy-node"}, Pods: "10/110"},
			{Ref: resourcemodel.ResourceRef{Name: "quiet-node"}, Pods: "2/110"},
		}, query, nodeTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"quiet-node", "busy-node"}, func(row NodeSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("namespace event object columns", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "objectType"
		page := applyTypedTableQuery([]EventSummary{
			{Ref: resourcemodel.ResourceRef{Name: "event-pod"}, Object: "Pod/api"},
			{Ref: resourcemodel.ResourceRef{Name: "event-deployment"}, Object: "Deployment/web"},
		}, query, namespacedEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-deployment", "event-pod"}, func(row EventSummary) string {
			return row.Ref.Name
		})

		query.Request.SortField = "objectName"
		page = applyTypedTableQuery([]EventSummary{
			{Ref: resourcemodel.ResourceRef{Name: "event-zulu"}, Object: "Pod/zulu"},
			{Ref: resourcemodel.ResourceRef{Name: "event-alpha"}, Object: "Pod/alpha"},
		}, query, namespacedEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-alpha", "event-zulu"}, func(row EventSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("autoscaling computed columns", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "scaleTarget"
		page := applyTypedTableQuery([]AutoscalingSummary{
			{Ref: resourcemodel.ResourceRef{Name: "web-hpa"}, Target: "Deployment/web"},
			{Ref: resourcemodel.ResourceRef{Name: "api-hpa"}, Target: "Deployment/api"},
		}, query, autoscalingTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"api-hpa", "web-hpa"}, func(row AutoscalingSummary) string {
			return row.Ref.Name
		})

		query.Request.SortField = "replicas"
		page = applyTypedTableQuery([]AutoscalingSummary{
			{Ref: resourcemodel.ResourceRef{Name: "large-hpa"}, Min: 3},
			{Ref: resourcemodel.ResourceRef{Name: "small-hpa"}, Min: 1},
		}, query, autoscalingTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"small-hpa", "large-hpa"}, func(row AutoscalingSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("helm updated column", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "updated"
		page := applyTypedTableQuery([]NamespaceHelmSummary{
			{Ref: resourcemodel.ResourceRef{Name: "old-release"}, Updated: "2026-06-01T10:00:00Z"},
			{Ref: resourcemodel.ResourceRef{Name: "new-release"}, Updated: "2026-06-02T10:00:00Z"},
		}, query, helmTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"old-release", "new-release"}, func(row NamespaceHelmSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("pod relationship columns", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "owner"
		page := applyTypedTableQuery([]PodSummary{
			{Ref: resourcemodel.ResourceRef{Name: "web-pod"}, OwnerName: "web"},
			{Ref: resourcemodel.ResourceRef{Name: "api-pod"}, OwnerName: "api"},
		}, query, podTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"api-pod", "web-pod"}, func(row PodSummary) string {
			return row.Ref.Name
		})

		query.Request.SortField = "node"
		page = applyTypedTableQuery([]PodSummary{
			{Ref: resourcemodel.ResourceRef{Name: "node-b-pod"}, Node: "node-b"},
			{Ref: resourcemodel.ResourceRef{Name: "node-a-pod"}, Node: "node-a"},
		}, query, podTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"node-a-pod", "node-b-pod"}, func(row PodSummary) string {
			return row.Ref.Name
		})

		query.Request.SortField = "ready"
		page = applyTypedTableQuery([]PodSummary{
			{Ref: resourcemodel.ResourceRef{Name: "less-ready-pod"}, Ready: "1/2"},
			{Ref: resourcemodel.ResourceRef{Name: "more-ready-pod"}, Ready: "2/2"},
		}, query, podTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"less-ready-pod", "more-ready-pod"}, func(row PodSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("pod metric columns", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "cpu"
		page := applyTypedTableQuery([]PodSummary{
			{Ref: resourcemodel.ResourceRef{Namespace: "default", Name: "high-cpu-pod"}, CPUUsage: "250m"},
			{Ref: resourcemodel.ResourceRef{Namespace: "default", Name: "low-cpu-pod"}, CPUUsage: "50m"},
		}, query, podTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"low-cpu-pod", "high-cpu-pod"}, func(row PodSummary) string {
			return row.Ref.Name
		})

		query.Request.SortField = "memory"
		page = applyTypedTableQuery([]PodSummary{
			{Ref: resourcemodel.ResourceRef{Namespace: "default", Name: "high-memory-pod"}, MemUsage: "256Mi"},
			{Ref: resourcemodel.ResourceRef{Namespace: "default", Name: "low-memory-pod"}, MemUsage: "64Mi"},
		}, query, podTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"low-memory-pod", "high-memory-pod"}, func(row PodSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("workload base columns", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "ready"
		page := applyTypedTableQuery([]WorkloadSummary{
			{Ref: resourcemodel.ResourceRef{Name: "less-ready-workload"}, Ready: "1/2"},
			{Ref: resourcemodel.ResourceRef{Name: "more-ready-workload"}, Ready: "2/2"},
		}, query, workloadTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"less-ready-workload", "more-ready-workload"}, func(row WorkloadSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("workload metric columns", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "cpu"
		page := applyTypedTableQuery([]WorkloadSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "high-cpu-workload"}, CPUUsage: "250m"},
			{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "low-cpu-workload"}, CPUUsage: "50m"},
		}, query, workloadTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"low-cpu-workload", "high-cpu-workload"}, func(row WorkloadSummary) string {
			return row.Ref.Name
		})

		query.Request.SortField = "memory"
		page = applyTypedTableQuery([]WorkloadSummary{
			{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "high-memory-workload"}, MemUsage: "256Mi"},
			{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "low-memory-workload"}, MemUsage: "64Mi"},
		}, query, workloadTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"low-memory-workload", "high-memory-workload"}, func(row WorkloadSummary) string {
			return row.Ref.Name
		})
	})
}

func TestStaticTableQuerySortsAgeByTimestampAcrossAdapters(t *testing.T) {
	query := typedTableQuery{
		Enabled:   true,
		BaseScope: "namespace:all",
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "test",
			SortField:     "age",
			SortDirection: "asc",
			Limit:         10,
		},
	}

	t.Run("namespace static rows", func(t *testing.T) {
		page := applyTypedTableQuery([]ConfigSummary{
			{Ref: testCanonicalRowRef("ConfigMap", "default", "old-config"), Age: "10d", AgeTimestamp: 1_700_000_000_000},
			{Ref: testCanonicalRowRef("ConfigMap", "default", "young-config"), Age: "2h", AgeTimestamp: 1_700_856_000_000},
		}, query, configTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"young-config", "old-config"}, func(row ConfigSummary) string {
			return row.Ref.Name
		})
	})

	t.Run("cluster static rows", func(t *testing.T) {
		query.BaseScope = "cluster"
		page := applyTypedTableQuery([]ClusterStorageEntry{
			{Ref: resourcemodel.ResourceRef{Name: "old-pv"}, Age: "10d", AgeTimestamp: 1_700_000_000_000},
			{Ref: resourcemodel.ResourceRef{Name: "young-pv"}, Age: "2h", AgeTimestamp: 1_700_856_000_000},
		}, query, clusterStorageTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"young-pv", "old-pv"}, func(row ClusterStorageEntry) string {
			return row.Ref.Name
		})
	})

	t.Run("cluster events", func(t *testing.T) {
		query.BaseScope = "cluster"
		page := applyTypedTableQuery([]ClusterEventEntry{
			{Ref: resourcemodel.ResourceRef{Name: "old-event"}, Age: "10d", AgeTimestamp: 1_700_000_000_000},
			{Ref: resourcemodel.ResourceRef{Name: "young-event"}, Age: "2h", AgeTimestamp: 1_700_856_000_000},
		}, query, clusterEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"young-event", "old-event"}, func(row ClusterEventEntry) string {
			return row.Ref.Name
		})
	})

	t.Run("namespace events", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		page := applyTypedTableQuery([]EventSummary{
			{Ref: resourcemodel.ResourceRef{Name: "old-event"}, Age: "10d", AgeTimestamp: 1_700_000_000_000},
			{Ref: resourcemodel.ResourceRef{Name: "young-event"}, Age: "2h", AgeTimestamp: 1_700_856_000_000},
		}, query, namespacedEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"young-event", "old-event"}, func(row EventSummary) string {
			return row.Ref.Name
		})
	})
}

func requireNodePageNames(t *testing.T, page typedTableQueryPage[NodeSummary], want []string) {
	t.Helper()
	if len(page.Rows) != len(want) {
		t.Fatalf("len(page.Rows)=%d, want %d", len(page.Rows), len(want))
	}
	for i, row := range page.Rows {
		if row.Ref.Name != want[i] {
			t.Fatalf("page.Rows[%d].Name=%q, want %q", i, row.Ref.Name, want[i])
		}
	}
}

func requirePageNames[T any](t *testing.T, rows []T, want []string, getName func(T) string) {
	t.Helper()
	if len(rows) != len(want) {
		t.Fatalf("len(rows)=%d, want %d", len(rows), len(want))
	}
	for i, row := range rows {
		if got := getName(row); got != want[i] {
			t.Fatalf("rows[%d].Name=%q, want %q", i, got, want[i])
		}
	}
}

func BenchmarkMigratedStaticTableQueries(b *testing.B) {
	query := migratedStaticQuery()
	query.Request.Search = "bench"
	query.Request.SortField = "name"
	query.Request.Limit = 250

	b.Run("config", func(b *testing.B) {
		rows := make([]ConfigSummary, 10000)
		for i := range rows {
			namespace := benchmarkNamespace(i)
			rows[i] = ConfigSummary{Ref: testCanonicalRowRef(benchmarkKind(i, "ConfigMap", "Secret"), namespace, benchmarkName("config", i)), Data: i % 16}
		}
		benchmarkTypedTableQuery(b, query, rows, configTableQueryAdapter())
	})
	b.Run("network", func(b *testing.B) {
		kinds := []string{"Service", "EndpointSlice", "Ingress", "NetworkPolicy", "Gateway", "HTTPRoute"}
		rows := make([]NetworkSummary, 10000)
		for i := range rows {
			rows[i] = NetworkSummary{Ref: resourcemodel.ResourceRef{Kind: kinds[i%len(kinds)], Namespace: benchmarkNamespace(i), Name: benchmarkName("network", i)}, Details: "bench route"}
		}
		benchmarkTypedTableQuery(b, query, rows, networkTableQueryAdapter())
	})
	b.Run("storage", func(b *testing.B) {
		rows := make([]StorageSummary, 10000)
		for i := range rows {
			rows[i] = StorageSummary{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolumeClaim", Namespace: benchmarkNamespace(i), Name: benchmarkName("pvc", i)}, Capacity: "10Gi", Status: "Bound", StorageClass: "bench-fast"}
		}
		benchmarkTypedTableQuery(b, query, rows, storageTableQueryAdapter())
	})
	b.Run("autoscaling", func(b *testing.B) {
		rows := make([]AutoscalingSummary, 10000)
		for i := range rows {
			rows[i] = AutoscalingSummary{Ref: resourcemodel.ResourceRef{Kind: "HorizontalPodAutoscaler", Namespace: benchmarkNamespace(i), Name: benchmarkName("hpa", i)}, Target: "Deployment/bench-api", Min: 1, Max: 10, Current: int32(i % 10)}
		}
		benchmarkTypedTableQuery(b, query, rows, autoscalingTableQueryAdapter())
	})
	b.Run("quotas", func(b *testing.B) {
		kinds := []string{"ResourceQuota", "LimitRange", "PodDisruptionBudget"}
		rows := make([]QuotaSummary, 10000)
		for i := range rows {
			rows[i] = QuotaSummary{Ref: resourcemodel.ResourceRef{Kind: kinds[i%len(kinds)], Namespace: benchmarkNamespace(i), Name: benchmarkName("quota", i)}, Details: "bench limits"}
		}
		benchmarkTypedTableQuery(b, query, rows, quotaTableQueryAdapter())
	})
	b.Run("rbac", func(b *testing.B) {
		kinds := []string{"Role", "RoleBinding", "ServiceAccount"}
		rows := make([]RBACSummary, 10000)
		for i := range rows {
			rows[i] = RBACSummary{Ref: resourcemodel.ResourceRef{Kind: kinds[i%len(kinds)], Namespace: benchmarkNamespace(i), Name: benchmarkName("rbac", i)}, Details: "bench access"}
		}
		benchmarkTypedTableQuery(b, query, rows, rbacTableQueryAdapter())
	})
	b.Run("helm", func(b *testing.B) {
		rows := make([]NamespaceHelmSummary, 10000)
		for i := range rows {
			rows[i] = NamespaceHelmSummary{Ref: resourcemodel.ResourceRef{Namespace: benchmarkNamespace(i), Name: benchmarkName("release", i)}, Chart: "bench-chart", AppVersion: "1.0.0", Status: "deployed", Revision: i % 9}
		}
		benchmarkTypedTableQuery(b, query, rows, helmTableQueryAdapter())
	})
	b.Run("namespace-events", func(b *testing.B) {
		rows := make([]EventSummary, 10000)
		for i := range rows {
			rows[i] = EventSummary{Ref: resourcemodel.ResourceRef{Namespace: benchmarkNamespace(i), Name: benchmarkName("event", i)}, Kind: "Event", Type: "Normal", Source: "bench-controller", Reason: "Scheduled", Object: "Pod/" + benchmarkName("pod", i), Message: "bench event"}
		}
		benchmarkTypedTableQuery(b, query, rows, namespacedEventTableQueryAdapter())
	})
	b.Run("pods", func(b *testing.B) {
		rows := make([]PodSummary, 10000)
		for i := range rows {
			rows[i] = PodSummary{Ref: resourcemodel.ResourceRef{Namespace: benchmarkNamespace(i), Name: benchmarkName("pod", i)}, Node: "node-" + strconv.Itoa(i%100), Status: "Running", Ready: "1/1", OwnerKind: "Deployment", OwnerName: "bench-api", CPUUsage: "10m", MemUsage: "64Mi"}
		}
		benchmarkTypedTableQuery(b, query, rows, podTableQueryAdapter())
	})
	b.Run("workloads", func(b *testing.B) {
		kinds := []string{"Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod"}
		rows := make([]WorkloadSummary, 10000)
		for i := range rows {
			rows[i] = WorkloadSummary{Ref: resourcemodel.ResourceRef{Kind: kinds[i%len(kinds)], Namespace: benchmarkNamespace(i), Name: benchmarkName("workload", i)}, Status: "Running", Ready: "1/1", CPUUsage: "10m", MemUsage: "64Mi"}
		}
		benchmarkTypedTableQuery(b, query, rows, workloadTableQueryAdapter())
	})
	b.Run("cluster-events", func(b *testing.B) {
		rows := make([]ClusterEventEntry, 10000)
		for i := range rows {
			rows[i] = ClusterEventEntry{Ref: resourcemodel.ResourceRef{Kind: "Event", Name: benchmarkName("cluster-event", i)}, Type: "Normal", Source: "bench-controller", Reason: "Scheduled", Object: "Node/" + benchmarkName("node", i), Message: "bench event"}
		}
		benchmarkTypedTableQuery(b, query, rows, clusterEventTableQueryAdapter())
	})
	b.Run("nodes", func(b *testing.B) {
		rows := make([]NodeSummary, 10000)
		for i := range rows {
			rows[i] = NodeSummary{Ref: resourcemodel.ResourceRef{Kind: "Node", Name: benchmarkName("node", i)}, Status: "Ready", Roles: "worker", Version: "v1.32.0", InternalIP: "10.0.0." + strconv.Itoa(i%255), CPUUsage: "100m", MemoryUsage: "1Gi", Pods: "20/110"}
		}
		benchmarkTypedTableQuery(b, query, rows, nodeTableQueryAdapter())
	})
	b.Run("cluster-config", func(b *testing.B) {
		kinds := []string{"StorageClass", "IngressClass", "GatewayClass", "ValidatingWebhookConfiguration", "MutatingWebhookConfiguration"}
		rows := make([]ClusterConfigEntry, 10000)
		for i := range rows {
			rows[i] = ClusterConfigEntry{Ref: testCanonicalRowRef(kinds[i%len(kinds)], "", benchmarkName("cluster-config", i)), Details: "bench controller"}
		}
		benchmarkTypedTableQuery(b, query, rows, clusterConfigTableQueryAdapter())
	})
	b.Run("cluster-storage", func(b *testing.B) {
		rows := make([]ClusterStorageEntry, 10000)
		for i := range rows {
			rows[i] = ClusterStorageEntry{Ref: resourcemodel.ResourceRef{Kind: "PersistentVolume", Name: benchmarkName("pv", i)}, StorageClass: "bench-fast", Capacity: "100Gi", AccessModes: "ReadWriteOnce", Status: "Available"}
		}
		benchmarkTypedTableQuery(b, query, rows, clusterStorageTableQueryAdapter())
	})
	b.Run("cluster-rbac", func(b *testing.B) {
		kinds := []string{"ClusterRole", "ClusterRoleBinding"}
		rows := make([]ClusterRBACEntry, 10000)
		for i := range rows {
			rows[i] = ClusterRBACEntry{Ref: resourcemodel.ResourceRef{Kind: kinds[i%len(kinds)], Name: benchmarkName("cluster-rbac", i)}, Details: "bench access"}
		}
		benchmarkTypedTableQuery(b, query, rows, clusterRBACTableQueryAdapter())
	})
	b.Run("cluster-crds", func(b *testing.B) {
		rows := make([]ClusterCRDEntry, 10000)
		for i := range rows {
			rows[i] = ClusterCRDEntry{Ref: resourcemodel.ResourceRef{Kind: "CustomResourceDefinition", Name: benchmarkName("widgets", i) + ".bench.example.com"}, Group: "bench.example.com", Scope: "Namespaced", Details: "bench resources", StorageVersion: "v1"}
		}
		benchmarkTypedTableQuery(b, query, rows, clusterCRDTableQueryAdapter())
	})
}

func benchmarkTypedTableQuery[T any](b *testing.B, query typedTableQuery, rows []T, adapter typedTableQueryAdapter[T]) {
	b.Helper()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = applyTypedTableQuery(rows, query, adapter)
	}
}

func benchmarkNamespace(i int) string {
	if i%2 == 0 {
		return "team-b"
	}
	return "team-a"
}

func benchmarkName(prefix string, i int) string {
	return "bench-" + prefix + "-" + strconv.Itoa(i)
}

func benchmarkKind(i int, first string, rest ...string) string {
	if len(rest) == 0 {
		return first
	}
	kinds := append([]string{first}, rest...)
	return kinds[i%len(kinds)]
}
