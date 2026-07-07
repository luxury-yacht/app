package snapshot

import (
	"fmt"
	"testing"
)

// anchorFor builds a valid same-cluster anchor ref for typed serve tests.
func anchorFor(kind, namespace, name string) *ResourceQueryAnchor {
	return &ResourceQueryAnchor{
		ClusterID: "c", Group: "", Version: "v1", Kind: kind,
		Namespace: namespace, Name: name,
	}
}

// configItems builds n ConfigMaps named cfg-000.. in one namespace, sorted
// order == name order, so ranks are predictable.
func configItems(n int) []ConfigSummary {
	items := make([]ConfigSummary, n)
	for i := 0; i < n; i++ {
		items[i] = ConfigSummary{
			Kind:      "ConfigMap",
			Name:      fmt.Sprintf("cfg-%03d", i),
			Namespace: "default",
		}
	}
	return items
}

// The per-Build path serves the page-aligned window for an anchored request:
// rank + pageStartRank exact, anchor on the page, ordinary cursors both ways,
// and Previous populated (F5).
func TestPerBuildAnchorServesAlignedPage(t *testing.T) {
	items := configItems(95)
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "namespace-config",
			SortField: "name", SortDirection: "asc", Limit: 20,
			Anchor: anchorFor("ConfigMap", "default", "cfg-047"),
		},
	}
	page := applyTypedTableQueryViaStore(items, query, configTableQueryAdapter(), configQuerypageSchema())

	if page.Anchor == nil || !page.Anchor.Found {
		t.Fatalf("anchor result = %+v, want found", page.Anchor)
	}
	if page.Anchor.Rank != 47 {
		t.Fatalf("rank = %d, want 47", page.Anchor.Rank)
	}
	if page.PageStartRank == nil || *page.PageStartRank != 40 {
		t.Fatalf("pageStartRank = %v, want 40", page.PageStartRank)
	}
	if len(page.Rows) != 20 || page.Rows[0].Name != "cfg-040" {
		t.Fatalf("window = %d rows starting %q, want 20 from cfg-040", len(page.Rows), page.Rows[0].Name)
	}
	if page.Previous == "" || page.Continue == "" {
		t.Fatalf("mid-list landing must mint both cursors (prev=%q cont=%q)", page.Previous, page.Continue)
	}
	if page.Total != 95 || !page.TotalIsExact {
		t.Fatalf("total = %d exact=%v", page.Total, page.TotalIsExact)
	}

	// The minted Previous pages backward into the previous aligned page.
	backQuery := query
	backQuery.Request.Anchor = nil
	backQuery.Request.Continue = page.Previous
	back := applyTypedTableQueryViaStore(items, backQuery, configTableQueryAdapter(), configQuerypageSchema())
	if len(back.Rows) != 20 || back.Rows[0].Name != "cfg-020" {
		t.Fatalf("backward page = %d rows starting %q, want 20 from cfg-020", len(back.Rows), back.Rows[0].Name)
	}
	if back.Anchor != nil {
		t.Fatal("cursor page must not carry an anchor result")
	}
}

// A per-Build store holds only matched rows, so the serve disambiguates via
// the full item list: excluded-by-filter → "filtered", absent → "not-found".
// Both serve the first page of the filtered set.
func TestPerBuildAnchorFilteredVsNotFound(t *testing.T) {
	items := []ConfigSummary{
		{Kind: "ConfigMap", Name: "app-a", Namespace: "default"},
		{Kind: "Secret", Name: "app-b", Namespace: "default"},
		{Kind: "ConfigMap", Name: "app-c", Namespace: "default"},
	}
	base := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "namespace-config",
			SortField: "name", SortDirection: "asc", Limit: 10,
			Kinds:  []string{"ConfigMap"},
			Anchor: anchorFor("Secret", "default", "app-b"),
		},
	}
	page := applyTypedTableQueryViaStore(items, base, configTableQueryAdapter(), configQuerypageSchema())
	if page.Anchor == nil || page.Anchor.Found || page.Anchor.Reason != "filtered" {
		t.Fatalf("kind-filtered anchor result = %+v, want reason=filtered", page.Anchor)
	}
	if len(page.Rows) != 2 || page.Rows[0].Name != "app-a" {
		t.Fatalf("filtered fallback page = %d rows starting %q, want the 2 ConfigMaps", len(page.Rows), page.Rows[0].Name)
	}

	base.Request.Anchor = anchorFor("ConfigMap", "default", "deleted-object")
	page = applyTypedTableQueryViaStore(items, base, configTableQueryAdapter(), configQuerypageSchema())
	if page.Anchor == nil || page.Anchor.Found || page.Anchor.Reason != "not-found" {
		t.Fatalf("absent anchor result = %+v, want reason=not-found", page.Anchor)
	}
	if page.Anchor.Rank != -1 {
		t.Fatalf("absent anchor rank = %d, want -1", page.Anchor.Rank)
	}
}

// F5: Previous is populated on EVERY response — a plain page 2 reached by
// continue token now carries the backend prev cursor.
func TestPerBuildPreviousOnEveryResponse(t *testing.T) {
	items := configItems(50)
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "namespace-config",
			SortField: "name", SortDirection: "asc", Limit: 20,
		},
	}
	page1 := applyTypedTableQueryViaStore(items, query, configTableQueryAdapter(), configQuerypageSchema())
	if page1.Previous != "" {
		t.Fatalf("page 1 previous = %q, want empty", page1.Previous)
	}
	query.Request.Continue = page1.Continue
	page2 := applyTypedTableQueryViaStore(items, query, configTableQueryAdapter(), configQuerypageSchema())
	if page2.Previous == "" {
		t.Fatal("page 2 must carry the backend previous cursor (F5)")
	}
	back := query
	back.Request.Continue = page2.Previous
	prev := applyTypedTableQueryViaStore(items, back, configTableQueryAdapter(), configQuerypageSchema())
	if len(prev.Rows) != 20 || prev.Rows[0].Name != "cfg-000" {
		t.Fatalf("previous page = %d rows starting %q, want page 1", len(prev.Rows), prev.Rows[0].Name)
	}
}

// Maintained-direct path: the store holds ALL rows, so the engine's own
// filtered/not-found outcome is authoritative, and the envelope carries the
// anchor result + rank + previous.
func TestMaintainedDirectAnchorServesAlignedPage(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c", ClusterName: "cluster"}
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")
	maintained := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	for i := 0; i < 45; i++ {
		maintained.ingest(hpaDesc, hpaObj("default", fmt.Sprintf("hpa-%03d", i), fmt.Sprintf("%d", i+1), "api", 4))
	}
	available := map[string]bool{"HorizontalPodAutoscaler": true}

	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "namespace-autoscaling",
			SortField: "name", SortDirection: "asc", Limit: 10,
			Anchor: anchorFor("HorizontalPodAutoscaler", "default", "hpa-027"),
		},
	}
	resolved := resolveMaintainedDirect(
		maintained.store, query, available, "", autoscalingTableQueryAdapter(),
		autoscalingQuerypageSchema(), ResourceQueryCapabilities{}, 100, "items",
		func(r AutoscalingSummary) string { return r.Kind },
		func() []AutoscalingSummary { return nil },
		nil,
	)

	env := resolved.Envelope
	if env.Anchor == nil || !env.Anchor.Found || env.Anchor.Rank != 27 {
		t.Fatalf("maintained anchor result = %+v, want found rank 27", env.Anchor)
	}
	if env.PageStartRank == nil || *env.PageStartRank != 20 {
		t.Fatalf("maintained pageStartRank = %v, want 20", env.PageStartRank)
	}
	if len(resolved.Rows) != 10 || resolved.Rows[0].Name != "hpa-020" {
		t.Fatalf("maintained window = %d rows starting %q", len(resolved.Rows), resolved.Rows[0].Name)
	}
	if env.Previous == "" || env.Continue == "" {
		t.Fatalf("maintained landing cursors: prev=%q cont=%q", env.Previous, env.Continue)
	}

	// Filtered outcome comes straight from the engine (store holds all rows):
	// a namespace filter that excludes the anchor row.
	query.Request.Namespaces = []string{"other-ns"}
	resolved = resolveMaintainedDirect(
		maintained.store, query, available, "", autoscalingTableQueryAdapter(),
		autoscalingQuerypageSchema(), ResourceQueryCapabilities{}, 100, "items",
		func(r AutoscalingSummary) string { return r.Kind },
		func() []AutoscalingSummary { return nil },
		nil,
	)
	if resolved.Envelope.Anchor == nil || resolved.Envelope.Anchor.Found ||
		resolved.Envelope.Anchor.Reason != "filtered" {
		t.Fatalf("maintained filtered anchor = %+v", resolved.Envelope.Anchor)
	}
}

// Metric-sort anchor regression (plan P3): metric-joined domains are per-Build
// with usage overlaid on the rows BEFORE the store is built, so an anchored
// jump on a cpu sort ranks against the CURRENT tick's values by construction.
func TestPerBuildAnchorOnMetricSortRanksByOverlaidUsage(t *testing.T) {
	items := make([]PodSummary, 10)
	for i := range items {
		items[i] = PodSummary{
			Name:      fmt.Sprintf("pod-%d", i),
			Namespace: "default",
			// Overlaid usage: descending as names ascend, so cpu order is the
			// REVERSE of name order — an anchor rank must follow cpu, not name.
			CPUUsage: fmt.Sprintf("%dm", (10-i)*100),
		}
	}
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "pods",
			SortField: "cpu", SortDirection: "desc", Limit: 3,
			Anchor: anchorFor("Pod", "default", "pod-4"),
		},
	}
	page := applyTypedTableQueryViaStore(items, query, podTableQueryAdapter(), podQuerypageSchema())
	if page.Anchor == nil || !page.Anchor.Found {
		t.Fatalf("metric-sort anchor result = %+v", page.Anchor)
	}
	// cpu desc: pod-0 (1000m) .. pod-9 (100m) → pod-4 (600m) is rank 4, page
	// start 3 at limit 3.
	if page.Anchor.Rank != 4 {
		t.Fatalf("metric-sort rank = %d, want 4", page.Anchor.Rank)
	}
	if page.PageStartRank == nil || *page.PageStartRank != 3 {
		t.Fatalf("metric-sort pageStartRank = %v, want 3", page.PageStartRank)
	}
	if page.Rows[1].Name != "pod-4" {
		t.Fatalf("anchor not at window offset 1: %v", page.Rows)
	}
}

// Every typed adapter's AnchorKey must reproduce its Key for the same object
// identity — the anchor→row-key resolution contract. A drift here silently
// breaks anchor jumps for that family.
func TestAdapterAnchorKeyMatchesKey(t *testing.T) {
	cases := []struct {
		family    string
		anchorKey func(kind, namespace, name string) string
		key       string
		kind      string
		namespace string
		name      string
	}{
		{"config", configTableQueryAdapter().AnchorKey, configTableQueryAdapter().Key(ConfigSummary{Kind: "ConfigMap", Namespace: "ns-a", Name: "obj"}), "ConfigMap", "ns-a", "obj"},
		{"network", networkTableQueryAdapter().AnchorKey, networkTableQueryAdapter().Key(NetworkSummary{Kind: "Service", Namespace: "ns-a", Name: "obj"}), "Service", "ns-a", "obj"},
		{"storage", storageTableQueryAdapter().AnchorKey, storageTableQueryAdapter().Key(StorageSummary{Kind: "PersistentVolumeClaim", Namespace: "ns-a", Name: "obj"}), "PersistentVolumeClaim", "ns-a", "obj"},
		{"autoscaling", autoscalingTableQueryAdapter().AnchorKey, autoscalingTableQueryAdapter().Key(AutoscalingSummary{Kind: "HorizontalPodAutoscaler", Namespace: "ns-a", Name: "obj"}), "HorizontalPodAutoscaler", "ns-a", "obj"},
		{"quotas", quotaTableQueryAdapter().AnchorKey, quotaTableQueryAdapter().Key(QuotaSummary{Kind: "ResourceQuota", Namespace: "ns-a", Name: "obj"}), "ResourceQuota", "ns-a", "obj"},
		{"rbac", rbacTableQueryAdapter().AnchorKey, rbacTableQueryAdapter().Key(RBACSummary{Kind: "Role", Namespace: "ns-a", Name: "obj"}), "Role", "ns-a", "obj"},
		{"helm", helmTableQueryAdapter().AnchorKey, helmTableQueryAdapter().Key(NamespaceHelmSummary{Namespace: "ns-a", Name: "obj"}), "HelmRelease", "ns-a", "obj"},
		{"events", namespacedEventTableQueryAdapter().AnchorKey, namespacedEventTableQueryAdapter().Key(EventSummary{Kind: "Pod", Namespace: "ns-a", Name: "obj"}), "Event", "ns-a", "obj"},
		{"pods", podTableQueryAdapter().AnchorKey, podTableQueryAdapter().Key(PodSummary{Namespace: "ns-a", Name: "obj"}), "Pod", "ns-a", "obj"},
		{"workloads", workloadTableQueryAdapter().AnchorKey, workloadTableQueryAdapter().Key(WorkloadSummary{Kind: "Deployment", Namespace: "ns-a", Name: "obj"}), "Deployment", "ns-a", "obj"},
	}
	for _, tc := range cases {
		if tc.anchorKey == nil {
			t.Errorf("%s: adapter has no AnchorKey", tc.family)
			continue
		}
		if got := tc.anchorKey(tc.kind, tc.namespace, tc.name); got != tc.key {
			t.Errorf("%s: AnchorKey(%q,%q,%q) = %q, want Key output %q",
				tc.family, tc.kind, tc.namespace, tc.name, got, tc.key)
		}
	}
}

// Cluster-scoped adapters resolve with an empty namespace.
func TestClusterAdapterAnchorKeyMatchesKey(t *testing.T) {
	cases := []struct {
		family    string
		anchorKey func(kind, namespace, name string) string
		key       string
		kind      string
		name      string
	}{
		{"nodes", nodeTableQueryAdapter().AnchorKey, nodeTableQueryAdapter().Key(NodeSummary{Name: "node-1"}), "Node", "node-1"},
		{"cluster-events", clusterEventTableQueryAdapter().AnchorKey, clusterEventTableQueryAdapter().Key(ClusterEventEntry{Name: "evt-1"}), "Event", "evt-1"},
		{"cluster-config", clusterConfigTableQueryAdapter().AnchorKey, clusterConfigTableQueryAdapter().Key(ClusterConfigEntry{Kind: "StorageClass", Name: "gp3"}), "StorageClass", "gp3"},
		{"cluster-storage", clusterStorageTableQueryAdapter().AnchorKey, clusterStorageTableQueryAdapter().Key(ClusterStorageEntry{Kind: "PersistentVolume", Name: "pv-1"}), "PersistentVolume", "pv-1"},
		{"cluster-rbac", clusterRBACTableQueryAdapter().AnchorKey, clusterRBACTableQueryAdapter().Key(ClusterRBACEntry{Kind: "ClusterRole", Name: "admin"}), "ClusterRole", "admin"},
		{"cluster-crds", clusterCRDTableQueryAdapter().AnchorKey, clusterCRDTableQueryAdapter().Key(ClusterCRDEntry{Name: "crd-1"}), "CustomResourceDefinition", "crd-1"},
	}
	for _, tc := range cases {
		if tc.anchorKey == nil {
			t.Errorf("%s: adapter has no AnchorKey", tc.family)
			continue
		}
		if got := tc.anchorKey(tc.kind, "", tc.name); got != tc.key {
			t.Errorf("%s: AnchorKey(%q,\"\",%q) = %q, want Key output %q",
				tc.family, tc.kind, tc.name, got, tc.key)
		}
	}
}

// StartRank serves the exact offset page with serve-time rank and self cursor
// on both engine paths — the numbered-jump serve.
func TestPerBuildStartRankServesOffsetPage(t *testing.T) {
	items := configItems(95)
	start := 40
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "namespace-config",
			SortField: "name", SortDirection: "asc", Limit: 20,
			StartRank: &start,
		},
	}
	page := applyTypedTableQueryViaStore(items, query, configTableQueryAdapter(), configQuerypageSchema())
	if page.PageStartRank == nil || *page.PageStartRank != 40 {
		t.Fatalf("pageStartRank = %v, want 40", page.PageStartRank)
	}
	if len(page.Rows) != 20 || page.Rows[0].Name != "cfg-040" {
		t.Fatalf("offset window = %d rows starting %q", len(page.Rows), page.Rows[0].Name)
	}
	if page.Previous == "" || page.Continue == "" || page.Self == "" {
		t.Fatalf("offset landing cursors: prev=%q cont=%q self=%q", page.Previous, page.Continue, page.Self)
	}
	if page.Anchor != nil {
		t.Fatal("offset page must not carry an anchor result")
	}
}

func TestMaintainedDirectStartRankServesOffsetPage(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c", ClusterName: "cluster"}
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")
	maintained := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	for i := 0; i < 45; i++ {
		maintained.ingest(hpaDesc, hpaObj("default", fmt.Sprintf("hpa-%03d", i), fmt.Sprintf("%d", i+1), "api", 4))
	}
	start := 30
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "namespace-autoscaling",
			SortField: "name", SortDirection: "asc", Limit: 10,
			StartRank: &start,
		},
	}
	resolved := resolveMaintainedDirect(
		maintained.store, query, map[string]bool{"HorizontalPodAutoscaler": true}, "",
		autoscalingTableQueryAdapter(), autoscalingQuerypageSchema(),
		ResourceQueryCapabilities{}, 100, "items",
		func(r AutoscalingSummary) string { return r.Kind },
		func() []AutoscalingSummary { return nil },
		nil,
	)
	env := resolved.Envelope
	if env.PageStartRank == nil || *env.PageStartRank != 30 {
		t.Fatalf("maintained pageStartRank = %v, want 30", env.PageStartRank)
	}
	if len(resolved.Rows) != 10 || resolved.Rows[0].Name != "hpa-030" {
		t.Fatalf("maintained offset window = %d rows starting %q", len(resolved.Rows), resolved.Rows[0].Name)
	}
	if env.Self == "" {
		t.Fatal("maintained offset landing minted no self cursor")
	}
}
