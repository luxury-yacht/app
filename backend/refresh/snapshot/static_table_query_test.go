package snapshot

import (
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
			{Kind: "ConfigMap", Namespace: "team-a", Name: "alpha", Data: 2},
			{Kind: "Secret", Namespace: "team-a", Name: "bravo", TypeAlias: "Opaque"},
			{Kind: "Secret", Namespace: "team-b", Name: "charlie"},
		}, query, configTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("network", func(t *testing.T) {
		page := applyTypedTableQuery([]NetworkSummary{
			{Kind: "Service", Namespace: "team-a", Name: "alpha", Details: "ClusterIP"},
			{Kind: "Ingress", Namespace: "team-a", Name: "bravo", Details: "host"},
			{Kind: "Service", Namespace: "team-b", Name: "charlie"},
		}, query, networkTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("storage", func(t *testing.T) {
		page := applyTypedTableQuery([]StorageSummary{
			{Kind: "PersistentVolumeClaim", Namespace: "team-a", Name: "alpha", Status: "Bound"},
			{Kind: "PersistentVolumeClaim", Namespace: "team-a", Name: "bravo", StorageClass: "fast"},
			{Kind: "PersistentVolumeClaim", Namespace: "team-b", Name: "charlie"},
		}, query, storageTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("autoscaling", func(t *testing.T) {
		page := applyTypedTableQuery([]AutoscalingSummary{
			{Kind: "HorizontalPodAutoscaler", Namespace: "team-a", Name: "alpha", Target: "Deployment/api", Current: 2},
			{Kind: "HorizontalPodAutoscaler", Namespace: "team-a", Name: "bravo", Target: "Deployment/web", Current: 3},
			{Kind: "HorizontalPodAutoscaler", Namespace: "team-b", Name: "charlie"},
		}, query, autoscalingTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("quotas", func(t *testing.T) {
		page := applyTypedTableQuery([]QuotaSummary{
			{Kind: "ResourceQuota", Namespace: "team-a", Name: "alpha", Details: "Hard: 2"},
			{Kind: "LimitRange", Namespace: "team-a", Name: "bravo", Details: "Limits: 1"},
			{Kind: "PodDisruptionBudget", Namespace: "team-b", Name: "charlie"},
		}, query, quotaTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("rbac", func(t *testing.T) {
		page := applyTypedTableQuery([]RBACSummary{
			{Kind: "Role", Namespace: "team-a", Name: "alpha", Details: "Rules: 1"},
			{Kind: "RoleBinding", Namespace: "team-a", Name: "bravo", Details: "Role: admin"},
			{Kind: "ServiceAccount", Namespace: "team-b", Name: "charlie"},
		}, query, rbacTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("helm", func(t *testing.T) {
		page := applyTypedTableQuery([]NamespaceHelmSummary{
			{Namespace: "team-a", Name: "alpha", Chart: "api", Revision: 1},
			{Namespace: "team-a", Name: "bravo", Chart: "web", Revision: 2},
			{Namespace: "team-b", Name: "charlie"},
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
			{Kind: "StorageClass", Name: "alpha-a"},
			{Kind: "IngressClass", Name: "alpha-b"},
			{Kind: "GatewayClass", Name: "charlie"},
		}, query, clusterConfigTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("storage", func(t *testing.T) {
		page := applyTypedTableQuery([]ClusterStorageEntry{
			{Kind: "PersistentVolume", Name: "alpha-a", Status: "Bound"},
			{Kind: "PersistentVolume", Name: "alpha-b", StorageClass: "fast"},
			{Kind: "PersistentVolume", Name: "charlie"},
		}, query, clusterStorageTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("rbac", func(t *testing.T) {
		page := applyTypedTableQuery([]ClusterRBACEntry{
			{Kind: "ClusterRole", Name: "alpha-a"},
			{Kind: "ClusterRoleBinding", Name: "alpha-b"},
			{Kind: "ClusterRole", Name: "charlie"},
		}, query, clusterRBACTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("crds", func(t *testing.T) {
		page := applyTypedTableQuery([]ClusterCRDEntry{
			{Kind: "Widget", Name: "alpha-a.example.com", Group: "example.com"},
			{Kind: "Widget", Name: "alpha-b.example.com", Group: "example.com"},
			{Kind: "Gadget", Name: "charlie.example.com", Group: "example.com"},
		}, query, clusterCRDTableQueryAdapter())
		assertMigratedPage(t, page)
	})

	t.Run("nodes", func(t *testing.T) {
		page := applyTypedTableQuery([]NodeSummary{
			{Kind: "Node", Name: "alpha-a", CPUUsage: "100m"},
			{Kind: "Node", Name: "alpha-b", CPUUsage: "200m"},
			{Kind: "Node", Name: "charlie", CPUUsage: "300m"},
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
		{Kind: "Node", Name: "old-node", Age: "10d", AgeTimestamp: 1_700_000_000_000},
		{Kind: "Node", Name: "young-node", Age: "2h", AgeTimestamp: 1_700_856_000_000},
	}, query, nodeTableQueryAdapter())

	if len(page.Rows) != 2 {
		t.Fatalf("len(page.Rows)=%d, want 2", len(page.Rows))
	}
	if page.Rows[0].Name != "young-node" {
		t.Fatalf("first node=%q, want young-node", page.Rows[0].Name)
	}

	query.Request.SortDirection = "desc"
	page = applyTypedTableQuery([]NodeSummary{
		{Kind: "Node", Name: "old-node", Age: "10d", AgeTimestamp: 1_700_000_000_000},
		{Kind: "Node", Name: "young-node", Age: "2h", AgeTimestamp: 1_700_856_000_000},
	}, query, nodeTableQueryAdapter())

	if page.Rows[0].Name != "old-node" {
		t.Fatalf("first node=%q, want old-node", page.Rows[0].Name)
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
		{Kind: "Node", Name: "old-node", Age: "10d", AgeTimestamp: 1_700_000_000_000},
		{Kind: "Node", Name: "middle-node", Age: "2d", AgeTimestamp: 1_700_691_200_000},
		{Kind: "Node", Name: "young-node", Age: "2h", AgeTimestamp: 1_700_856_000_000},
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
			{Name: "widgets.example.com", StorageVersion: "v2"},
			{Name: "gadgets.example.com", StorageVersion: "v1"},
		}, query, clusterCRDTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"gadgets.example.com", "widgets.example.com"}, func(row ClusterCRDEntry) string {
			return row.Name
		})
	})

	t.Run("cluster storage access modes column", func(t *testing.T) {
		query.Request.SortField = "accessModes"
		page := applyTypedTableQuery([]ClusterStorageEntry{
			{Name: "pv-read-write-many", AccessModes: "ReadWriteMany"},
			{Name: "pv-read-only-many", AccessModes: "ReadOnlyMany"},
		}, query, clusterStorageTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"pv-read-only-many", "pv-read-write-many"}, func(row ClusterStorageEntry) string {
			return row.Name
		})
	})

	t.Run("cluster event object columns", func(t *testing.T) {
		query.Request.SortField = "objectType"
		page := applyTypedTableQuery([]ClusterEventEntry{
			{Name: "event-pod", Object: "Pod/api"},
			{Name: "event-deployment", Object: "Deployment/web"},
		}, query, clusterEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-deployment", "event-pod"}, func(row ClusterEventEntry) string {
			return row.Name
		})

		query.Request.SortField = "objectName"
		page = applyTypedTableQuery([]ClusterEventEntry{
			{Name: "event-zulu", Object: "Pod/zulu"},
			{Name: "event-alpha", Object: "Pod/alpha"},
		}, query, clusterEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-alpha", "event-zulu"}, func(row ClusterEventEntry) string {
			return row.Name
		})
	})

	t.Run("namespace event object columns", func(t *testing.T) {
		query.BaseScope = "namespace:all"
		query.Request.SortField = "objectType"
		page := applyTypedTableQuery([]EventSummary{
			{Name: "event-pod", Object: "Pod/api"},
			{Name: "event-deployment", Object: "Deployment/web"},
		}, query, namespacedEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-deployment", "event-pod"}, func(row EventSummary) string {
			return row.Name
		})

		query.Request.SortField = "objectName"
		page = applyTypedTableQuery([]EventSummary{
			{Name: "event-zulu", Object: "Pod/zulu"},
			{Name: "event-alpha", Object: "Pod/alpha"},
		}, query, namespacedEventTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"event-alpha", "event-zulu"}, func(row EventSummary) string {
			return row.Name
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
			{Name: "old-config", Age: "10d", AgeTimestamp: 1_700_000_000_000},
			{Name: "young-config", Age: "2h", AgeTimestamp: 1_700_856_000_000},
		}, query, configTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"young-config", "old-config"}, func(row ConfigSummary) string {
			return row.Name
		})
	})

	t.Run("cluster static rows", func(t *testing.T) {
		query.BaseScope = "cluster"
		page := applyTypedTableQuery([]ClusterStorageEntry{
			{Name: "old-pv", Age: "10d", AgeTimestamp: 1_700_000_000_000},
			{Name: "young-pv", Age: "2h", AgeTimestamp: 1_700_856_000_000},
		}, query, clusterStorageTableQueryAdapter())
		requirePageNames(t, page.Rows, []string{"young-pv", "old-pv"}, func(row ClusterStorageEntry) string {
			return row.Name
		})
	})
}

func requireNodePageNames(t *testing.T, page typedTableQueryPage[NodeSummary], want []string) {
	t.Helper()
	if len(page.Rows) != len(want) {
		t.Fatalf("len(page.Rows)=%d, want %d", len(page.Rows), len(want))
	}
	for i, row := range page.Rows {
		if row.Name != want[i] {
			t.Fatalf("page.Rows[%d].Name=%q, want %q", i, row.Name, want[i])
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
	query.Request.Limit = 250
	rows := make([]ConfigSummary, 10000)
	for i := range rows {
		namespace := "team-a"
		if i%2 == 0 {
			namespace = "team-b"
		}
		rows[i] = ConfigSummary{Kind: "ConfigMap", Namespace: namespace, Name: "config-" + strconv.Itoa(i)}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = applyTypedTableQuery(rows, query, configTableQueryAdapter())
	}
}
