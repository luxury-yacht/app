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
