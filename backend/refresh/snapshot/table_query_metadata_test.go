package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// Every table whose rows carry labels and annotations searches them when the
// request includes metadata, and only then.
func TestTableQueriesSearchRowMetadataOnlyWhenRequested(t *testing.T) {
	meta := &resourcemodel.ResourceTableMetadata{
		Labels:      map[string]string{"team": "payments"},
		Annotations: map[string]string{"owner": "search-team"},
	}
	ref := func(kind, namespace string) resourcemodel.ResourceRef {
		return resourcemodel.ResourceRef{Kind: kind, Namespace: namespace, Name: "row-a"}
	}

	t.Run("workloads", func(t *testing.T) {
		requireMetadataSearch(t, workloadTableQueryAdapter(), WorkloadSummary{Ref: ref("Deployment", "team-a"), Metadata: meta})
	})
	t.Run("pods", func(t *testing.T) {
		requireMetadataSearch(t, podTableQueryAdapter(), PodSummary{Ref: ref("Pod", "team-a"), Metadata: meta})
	})
	t.Run("config", func(t *testing.T) {
		requireMetadataSearch(t, configTableQueryAdapter(), ConfigSummary{Ref: ref("ConfigMap", "team-a"), Metadata: meta})
	})
	t.Run("network", func(t *testing.T) {
		requireMetadataSearch(t, networkTableQueryAdapter(), NetworkSummary{Ref: ref("Service", "team-a"), Metadata: meta})
	})
	t.Run("storage", func(t *testing.T) {
		requireMetadataSearch(t, storageTableQueryAdapter(), StorageSummary{Ref: ref("PersistentVolumeClaim", "team-a"), Metadata: meta})
	})
	t.Run("autoscaling", func(t *testing.T) {
		requireMetadataSearch(t, autoscalingTableQueryAdapter(), AutoscalingSummary{Ref: ref("HorizontalPodAutoscaler", "team-a"), Metadata: meta})
	})
	t.Run("quotas", func(t *testing.T) {
		requireMetadataSearch(t, quotaTableQueryAdapter(), QuotaSummary{Ref: ref("ResourceQuota", "team-a"), Metadata: meta})
	})
	t.Run("rbac", func(t *testing.T) {
		requireMetadataSearch(t, rbacTableQueryAdapter(), RBACSummary{Ref: ref("Role", "team-a"), Metadata: meta})
	})
	t.Run("namespace events", func(t *testing.T) {
		requireMetadataSearch(t, namespacedEventTableQueryAdapter(), EventSummary{Ref: ref("Event", "team-a"), Metadata: meta})
	})
	t.Run("cluster events", func(t *testing.T) {
		requireMetadataSearch(t, clusterEventTableQueryAdapter(), ClusterEventEntry{Ref: ref("Event", "team-a"), Metadata: meta})
	})
	t.Run("cluster config", func(t *testing.T) {
		requireMetadataSearch(t, clusterConfigTableQueryAdapter(), ClusterConfigEntry{Ref: ref("StorageClass", ""), Metadata: meta})
	})
	t.Run("cluster storage", func(t *testing.T) {
		requireMetadataSearch(t, clusterStorageTableQueryAdapter(), ClusterStorageEntry{Ref: ref("PersistentVolume", ""), Metadata: meta})
	})
	t.Run("cluster rbac", func(t *testing.T) {
		requireMetadataSearch(t, clusterRBACTableQueryAdapter(), ClusterRBACEntry{Ref: ref("ClusterRole", ""), Metadata: meta})
	})
	t.Run("crds", func(t *testing.T) {
		requireMetadataSearch(t, clusterCRDTableQueryAdapter(), ClusterCRDEntry{Ref: ref("CustomResourceDefinition", ""), Metadata: meta})
	})
	t.Run("attention", func(t *testing.T) {
		requireMetadataSearch(t, attentionTableQueryAdapter(), AttentionFinding{Ref: ref("Pod", "team-a"), Namespace: "team-a", Metadata: meta})
	})
}

// requireMetadataSearch checks that a label value and an annotation value match
// the row only when the request includes metadata.
func requireMetadataSearch[T any](t *testing.T, adapter typedTableQueryAdapter[T], row T) {
	t.Helper()
	for _, search := range []string{"payments", "search-team"} {
		query := typedTableQuery{
			Enabled:   true,
			BaseScope: "namespace:all",
			Request: ResourceQueryRequest{
				ClusterID: "cluster-a",
				Table:     "test",
				Limit:     10,
				Search:    search,
			},
		}
		if got := len(applyTypedTableQuery([]T{row}, query, adapter).Rows); got != 0 {
			t.Fatalf("search %q without metadata matched %d rows, want 0", search, got)
		}
		query.Request.IncludeMetadata = true
		if got := len(applyTypedTableQuery([]T{row}, query, adapter).Rows); got != 1 {
			t.Fatalf("search %q with metadata matched %d rows, want 1", search, got)
		}
	}
}

// Domains served from a maintained store (config, RBAC, storage, quotas,
// autoscaling, the cluster-scoped ones, attention) answer through
// resolveMaintainedDirect, not the per-build matcher above. Metadata search must
// work there too: rows, total and facet counts all include label and annotation
// matches, and only when the request asks for metadata.
func TestMaintainedDirectSearchesRowMetadataOnlyWhenRequested(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c", ClusterName: "cluster"}
	adapter := autoscalingTableQueryAdapter()
	maintained := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), adapter)
	ref := func(name string) resourcemodel.ResourceRef {
		return resourcemodel.ResourceRef{Kind: "HorizontalPodAutoscaler", Namespace: "default", Name: name}
	}
	maintained.store.Upsert(AutoscalingSummary{
		Ref:      ref("hpa-a"),
		Metadata: &resourcemodel.ResourceTableMetadata{Labels: map[string]string{"team": "Payments"}},
	})
	maintained.store.Upsert(AutoscalingSummary{
		Ref:      ref("hpa-b"),
		Metadata: &resourcemodel.ResourceTableMetadata{Annotations: map[string]string{"owner": "search-team"}},
	})
	maintained.store.Upsert(AutoscalingSummary{Ref: ref("hpa-c")})

	serve := func(search string, includeMetadata bool) typedSnapshotPage[AutoscalingSummary] {
		query := typedTableQuery{
			Enabled: true,
			Request: ResourceQueryRequest{
				ClusterID: "c", Table: "namespace-autoscaling",
				SortField: "name", SortDirection: "asc", Limit: 10,
				Search: search, IncludeMetadata: includeMetadata,
			},
		}
		return resolveMaintainedDirect(
			maintained.store,
			query,
			maintainedQueryScope{availableKinds: map[string]bool{"HorizontalPodAutoscaler": true}},
			adapter,
			autoscalingQuerypageSchema(),
			func() []AutoscalingSummary { return nil },
			newTypedSnapshotPageConfig(
				ResourceQueryCapabilities{}, 100, "items",
				func(r AutoscalingSummary) string { return r.Ref.Kind },
				nil,
			),
		)
	}

	if page := serve("payments", false); len(page.Rows) != 0 || page.Envelope.Total != 0 {
		t.Fatalf("label search without metadata: %d rows, total %d, want none", len(page.Rows), page.Envelope.Total)
	}
	for search, want := range map[string]string{
		"payments":           "hpa-a", // label value, case-insensitive
		"team: payments":     "hpa-a", // key: value form
		"search-team":        "hpa-b", // annotation value
		"owner: search-team": "hpa-b",
	} {
		page := serve(search, true)
		if len(page.Rows) != 1 || page.Rows[0].Ref.Name != want || page.Envelope.Total != 1 {
			t.Fatalf("search %q with metadata: rows %v total %d, want only %s", search, page.Rows, page.Envelope.Total, want)
		}
	}
	// The normal search text still matches with metadata on.
	if page := serve("hpa-c", true); len(page.Rows) != 1 || page.Envelope.Total != 1 {
		t.Fatalf("name search with metadata: rows %v total %d, want hpa-c", page.Rows, page.Envelope.Total)
	}
}
