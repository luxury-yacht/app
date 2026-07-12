package snapshot

import (
	"context"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"unsafe"

	"github.com/luxury-yacht/app/backend/objectcatalog"
)

func TestParseBrowseScope(t *testing.T) {
	opts, err := parseBrowseScope("kind=Pod&namespace=default&namespace=cluster&search=nginx&limit=50&continue=10")
	if err != nil {
		t.Fatalf("parseBrowseScope returned error: %v", err)
	}
	if len(opts.Kinds) != 1 || opts.Kinds[0] != "Pod" {
		t.Fatalf("unexpected kinds: %+v", opts.Kinds)
	}
	if len(opts.Namespaces) != 2 {
		t.Fatalf("unexpected namespaces: %+v", opts.Namespaces)
	}
	if opts.Search != "nginx" {
		t.Fatalf("expected search nginx, got %q", opts.Search)
	}
	if opts.Limit != 50 {
		t.Fatalf("expected limit 50, got %d", opts.Limit)
	}
	if opts.Continue != "10" {
		t.Fatalf("expected continue 10, got %q", opts.Continue)
	}
}

func TestParseBrowseScopePreservesStructuralBoundary(t *testing.T) {
	opts, err := parseBrowseScope("resourceScope=namespace&scopeNamespace=default&namespace=default&kind=Pod&limit=50")
	if err != nil {
		t.Fatalf("parseBrowseScope returned error: %v", err)
	}
	query := opts.toQueryOptions()
	if query.Scope != objectcatalog.ScopeNamespace {
		t.Fatalf("expected namespace structural scope, got %q", query.Scope)
	}
	if !reflect.DeepEqual(query.ScopeNamespaces, []string{"default"}) {
		t.Fatalf("expected structural namespace boundary [default], got %+v", query.ScopeNamespaces)
	}
}

func TestCatalogBuildUsesCatalogOnly(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "pod-a",
			UID:       "uid-a",
			Scope:     objectcatalog.ScopeNamespace,
		},
		{
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "default",
			Name:      "deploy-b",
			UID:       "uid-b",
			Scope:     objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)

	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
	}

	snap, err := builder.Build(context.Background(), "limit=1")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if payload.Total != 2 {
		t.Fatalf("expected total 2, got %d", payload.Total)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected page size 1, got %d", len(payload.Items))
	}
	if payload.Continue == "" {
		t.Fatalf("expected continue token for subsequent page")
	}
	if payload.Items[0].UID == "" {
		t.Fatalf("expected UID to be preserved")
	}
	if payload.BatchIndex != 0 {
		t.Fatalf("expected batch index 0, got %d", payload.BatchIndex)
	}
	if payload.BatchSize != 1 {
		t.Fatalf("expected batch size 1, got %d", payload.BatchSize)
	}
	if payload.TotalBatches != 2 {
		t.Fatalf("expected total batches 2, got %d", payload.TotalBatches)
	}
	if payload.IsFinal {
		t.Fatalf("expected non-final batch when continue token present")
	}
	expectedKinds := []objectcatalog.KindInfo{
		{Kind: "Deployment", Namespaced: true},
		{Kind: "Pod", Namespaced: true},
	}
	if !reflect.DeepEqual(payload.Kinds, expectedKinds) {
		t.Fatalf("unexpected kinds in payload: %+v", payload.Kinds)
	}
	if !reflect.DeepEqual(payload.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces in payload: %+v", payload.Namespaces)
	}
}

func TestCatalogBuildClusterScopedNamespaceSentinel(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			ClusterID:       "cluster-a",
			ClusterName:     "Cluster A",
			Kind:            "CustomResourceDefinition",
			Group:           "apiextensions.k8s.io",
			Version:         "v1",
			Resource:        "customresourcedefinitions",
			Name:            "widgets.example.com",
			UID:             "uid-crd",
			ResourceVersion: "1",
			Scope:           objectcatalog.ScopeCluster,
		},
		{
			ClusterID:       "cluster-a",
			ClusterName:     "Cluster A",
			Kind:            "Service",
			Group:           "",
			Version:         "v1",
			Resource:        "services",
			Namespace:       "default",
			Name:            "web",
			UID:             "uid-service",
			ResourceVersion: "2",
			Scope:           objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)
	markCatalogCachesReady(t, svc, summaries)

	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
	}

	snap, err := builder.Build(context.Background(), "cluster-a|limit=50&namespace=cluster")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if payload.Total != 1 {
		t.Fatalf("expected one cluster-scoped match, got total=%d payload=%+v", payload.Total, payload)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected one cluster-scoped row, got %+v", payload.Items)
	}
	item := payload.Items[0]
	if item.Scope != objectcatalog.ScopeCluster {
		t.Fatalf("expected cluster-scoped row, got %+v", item)
	}
	if item.Namespace != "" {
		t.Fatalf("expected cluster-scoped row to have empty namespace, got %q", item.Namespace)
	}
	if item.Group != "apiextensions.k8s.io" || item.Version != "v1" ||
		item.Kind != "CustomResourceDefinition" || item.Resource != "customresourcedefinitions" ||
		item.Name != "widgets.example.com" || item.UID != "uid-crd" {
		t.Fatalf("cluster-scoped identity was not preserved: %+v", item)
	}
	if !reflect.DeepEqual(payload.Kinds, []objectcatalog.KindInfo{
		{Kind: "CustomResourceDefinition", Namespaced: false},
	}) {
		t.Fatalf("unexpected cluster-scoped kind facets: %+v", payload.Kinds)
	}
	if !reflect.DeepEqual(payload.Namespaces, []string{"default"}) {
		t.Fatalf("expected namespace facets to exclude literal cluster sentinel, got %+v", payload.Namespaces)
	}
}

func TestCatalogSnapshotMetadataUsesKeysetSemantics(t *testing.T) {
	payload, _ := buildCatalogSnapshot(
		objectcatalog.QueryResult{
			Items: []objectcatalog.Summary{{
				Kind:      "Pod",
				Version:   "v1",
				Resource:  "pods",
				Namespace: "default",
				Name:      "pod-b",
			}},
			ContinueToken: "next-keyset",
			PreviousToken: "previous-keyset",
			TotalItems:    3,
			TotalIsExact:  true,
			FacetsExact:   true,
		},
		browseQueryOptions{Limit: 1, Continue: "previous-keyset"},
		objectcatalog.HealthStatus{},
		true,
		false,
	)

	if !payload.HasNext || !payload.HasPrevious {
		t.Fatalf("expected keyset next/previous flags, got next=%t previous=%t", payload.HasNext, payload.HasPrevious)
	}
	if payload.BatchIndex != -1 {
		t.Fatalf("expected keyset batch index sentinel -1, got %d", payload.BatchIndex)
	}
	if payload.TotalBatches != 0 {
		t.Fatalf("expected no offset total batches for previous keyset page, got %d", payload.TotalBatches)
	}
}

func TestCatalogSnapshotIssuesDescribeApproximateAndDegradedResults(t *testing.T) {
	payload, _ := buildCatalogSnapshot(
		objectcatalog.QueryResult{
			Items: []objectcatalog.Summary{{
				Kind:      "Pod",
				Version:   "v1",
				Resource:  "pods",
				Namespace: "default",
				Name:      "pod-a",
			}},
			ContinueToken: "next-keyset",
			PreviousToken: "previous-keyset",
			TotalItems:    200000,
			TotalIsExact:  false,
			FacetsExact:   false,
			CursorInvalid: true,
		},
		browseQueryOptions{Limit: 1},
		objectcatalog.HealthStatus{
			Status:          objectcatalog.HealthStateDegraded,
			Stale:           true,
			FailedResources: 2,
			LastError:       "forbidden",
		},
		true,
		false,
	)

	// A degraded catalog keeps its keyset cursor (churn-safe, self-invalidating);
	// it only downgrades completeness and surfaces the health/approximation issues.
	if payload.Continue != "next-keyset" || !payload.HasNext {
		t.Fatalf("expected degraded catalog to keep pagination, continue=%q hasNext=%t", payload.Continue, payload.HasNext)
	}
	if payload.Previous != "previous-keyset" || !payload.HasPrevious {
		t.Fatalf("expected degraded catalog to keep previous pagination, previous=%q hasPrevious=%t", payload.Previous, payload.HasPrevious)
	}
	var messages []string
	for _, issue := range payload.Issues {
		messages = append(messages, issue.Kind+": "+issue.Message)
	}
	joined := strings.Join(messages, "\n")
	for _, expected := range []string{
		"Catalog cursor",
		"Catalog totals",
		"Catalog facets",
		"Catalog health",
		"Failed resources: 2",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected issue text %q in:\n%s", expected, joined)
		}
	}
	if strings.Contains(joined, "Catalog pagination") {
		t.Fatalf("degraded catalog must not report pagination as disabled:\n%s", joined)
	}
}

// A degraded/stale sync RETAINS its already-collected data (see
// restoreDescriptorEntries), and the querypage keyset cursor stays valid across
// churn (a mismatched cursor self-resets via CursorInvalid). So pagination MUST
// keep working while degraded — previously the cursor was cleared, which silently
// disabled Next for every catalog view whenever a single resource type failed to
// list (a PartialSyncError flips health.Stale). Regression for that.
func TestCatalogDegradedSyncKeepsKeysetPagination(t *testing.T) {
	payload, _ := buildCatalogSnapshot(
		objectcatalog.QueryResult{
			Items: []objectcatalog.Summary{{
				Kind:      "Pod",
				Version:   "v1",
				Resource:  "pods",
				Namespace: "default",
				Name:      "pod-a",
			}},
			ContinueToken: "next-keyset",
			PreviousToken: "previous-keyset",
			TotalItems:    5000,
			TotalIsExact:  true,
			FacetsExact:   true,
		},
		browseQueryOptions{Limit: 50},
		objectcatalog.HealthStatus{
			Status:          objectcatalog.HealthStateDegraded,
			Stale:           true,
			FailedResources: 1,
			LastError:       "list widgets.example.com: the server is currently unable to handle the request",
		},
		true,  // cachesReady
		false, // forceFinal
	)

	if payload.Continue != "next-keyset" || !payload.HasNext {
		t.Fatalf("degraded catalog must keep forward pagination: continue=%q hasNext=%t", payload.Continue, payload.HasNext)
	}
	if payload.Previous != "previous-keyset" || !payload.HasPrevious {
		t.Fatalf("degraded catalog must keep backward pagination: previous=%q hasPrevious=%t", payload.Previous, payload.HasPrevious)
	}
	for _, issue := range payload.Issues {
		if issue.Kind == "Catalog pagination" {
			t.Fatalf("degraded catalog must not report pagination as disabled: %q", issue.Message)
		}
	}
}

// An RBAC-blocked catalog must be distinguishable from an empty cluster: the
// denied resource types surface as a "Catalog permissions" issue.
func TestCatalogSnapshotIssuesReportDeniedResources(t *testing.T) {
	payload, _ := buildCatalogSnapshot(
		objectcatalog.QueryResult{TotalIsExact: true, FacetsExact: true},
		browseQueryOptions{Limit: 1},
		objectcatalog.HealthStatus{
			Status: objectcatalog.HealthStateOK,
			DeniedResources: []string{
				"secrets",
				"widgets.example.com",
				"a", "b", "c", "d",
			},
		},
		false,
		false,
	)

	var permissions string
	for _, issue := range payload.Issues {
		if issue.Kind == "Catalog permissions" {
			permissions = issue.Message
		}
	}
	if permissions == "" {
		t.Fatalf("expected a Catalog permissions issue, got %+v", payload.Issues)
	}
	for _, expected := range []string{"secrets", "widgets.example.com", "and 1 more"} {
		if !strings.Contains(permissions, expected) {
			t.Fatalf("expected %q in permissions issue %q", expected, permissions)
		}
	}
}

func TestCatalogBuildPreservesContinueWhenCachesReady(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "alpha",
			UID:             "uid-alpha",
			ResourceVersion: "1",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "bravo",
			UID:             "uid-bravo",
			ResourceVersion: "2",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Pod",
			Group:           "",
			Version:         "v1",
			Resource:        "pods",
			Namespace:       "kube-system",
			Name:            "charlie",
			UID:             "uid-charlie",
			ResourceVersion: "3",
			Scope:           objectcatalog.ScopeNamespace,
		},
	}

	svc := seedCatalogService(t, summaries)
	markCatalogCachesReady(t, svc, summaries)

	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
	}

	snap, err := builder.Build(context.Background(), "limit=2")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if payload.Total != len(summaries) {
		t.Fatalf("expected total %d, got %d", len(summaries), payload.Total)
	}
	if payload.Continue == "" {
		t.Fatalf("expected continue token to be preserved when caches are ready")
	}
	if payload.IsFinal {
		t.Fatal("expected non-final payload while continue token is present")
	}
}

func TestCatalogSnapshotAndStreamUseSameCatalogQueryContract(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "alpha",
			UID:             "uid-alpha",
			ResourceVersion: "1",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "bravo",
			UID:             "uid-bravo",
			ResourceVersion: "2",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Pod",
			Group:           "",
			Version:         "v1",
			Resource:        "pods",
			Namespace:       "kube-system",
			Name:            "ignored",
			UID:             "uid-ignored",
			ResourceVersion: "3",
			Scope:           objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)
	markCatalogCachesReady(t, svc, summaries)

	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"}
	scope := "cluster-a|kind=Deployment&namespace=default&limit=1"
	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
	}

	snap, err := builder.Build(WithClusterMeta(context.Background(), meta), scope)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if snap.Domain != catalogDomain {
		t.Fatalf("expected catalog domain, got %q", snap.Domain)
	}
	if snap.Scope != scope {
		t.Fatalf("expected scope %q, got %q", scope, snap.Scope)
	}
	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if payload.ClusterID != meta.ClusterID || payload.ClusterName != meta.ClusterName {
		t.Fatalf("snapshot lost cluster metadata: %+v", payload.ClusterMeta)
	}
	if payload.Total != 2 || len(payload.Items) != 1 || payload.Continue == "" {
		t.Fatalf("unexpected paginated payload: total=%d len=%d continue=%q", payload.Total, len(payload.Items), payload.Continue)
	}
	if item := payload.Items[0]; item.UID != "uid-alpha" || item.Group != "apps" || item.Version != "v1" || item.Resource != "deployments" {
		t.Fatalf("snapshot lost catalog identity fields: %+v", item)
	}

}

func TestCatalogRefreshAdapterBuildsSnapshotFromSharedAssembly(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "alpha",
			UID:             "uid-alpha",
			ResourceVersion: "1",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "bravo",
			UID:             "uid-bravo",
			ResourceVersion: "2",
			Scope:           objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)
	markCatalogCachesReady(t, svc, summaries)

	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"}
	groups := []CatalogNamespaceGroup{{
		ClusterMeta: meta,
		Namespaces:  []string{"default", "kube-system"},
	}}
	adapter := newCatalogRefreshAdapter(svc, meta, func() []CatalogNamespaceGroup {
		return groups
	})
	opts, err := parseBrowseScope("cluster-a|kind=Deployment&namespace=default&limit=1")
	if err != nil {
		t.Fatalf("parseBrowseScope returned error: %v", err)
	}

	snap := adapter.BuildSnapshot(catalogDomain, "cluster-a|kind=Deployment&namespace=default&limit=1", opts)
	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if snap.Stats.ItemCount != len(payload.Items) ||
		snap.Stats.TotalItems != payload.Total ||
		snap.Stats.Truncated != (payload.Continue != "") {
		t.Fatalf("snapshot stats diverged from payload: stats=%+v payload=%+v", snap.Stats, payload)
	}
	if len(payload.NamespaceGroups) != 1 {
		t.Fatalf("expected namespace groups on payload: snapshot=%+v", payload.NamespaceGroups)
	}
}

func TestCatalogDiffBuildUsesCatalogSnapshotQueryContract(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "alpha",
			UID:             "uid-alpha",
			ResourceVersion: "1",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "beta",
			UID:             "uid-beta",
			ResourceVersion: "2",
			Scope:           objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)
	markCatalogCachesReady(t, svc, summaries)

	builder := &catalogBuilder{
		domain:         catalogDiffDomain,
		catalogService: func() *objectcatalog.Service { return svc },
	}
	scope := "cluster-a|kind=Deployment&namespace=default&search=beta&limit=50"
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"}
	snap, err := builder.Build(WithClusterMeta(context.Background(), meta), scope)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if snap.Domain != catalogDiffDomain {
		t.Fatalf("expected catalog-diff domain, got %q", snap.Domain)
	}
	if snap.Scope != scope {
		t.Fatalf("expected scope %q, got %q", scope, snap.Scope)
	}
	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if payload.ClusterID != meta.ClusterID || payload.ClusterName != meta.ClusterName {
		t.Fatalf("catalog-diff lost cluster metadata: %+v", payload.ClusterMeta)
	}
	if payload.Total != 1 || len(payload.Items) != 1 {
		t.Fatalf("expected one filtered diff item, got total=%d len=%d", payload.Total, len(payload.Items))
	}
	item := payload.Items[0]
	if item.UID != "uid-beta" || item.Group != "apps" || item.Version != "v1" || item.Resource != "deployments" {
		t.Fatalf("catalog-diff lost catalog identity fields: %+v", item)
	}
}

func TestCatalogBuildErrorsWhenServiceUnavailable(t *testing.T) {
	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return nil },
	}
	_, err := builder.Build(context.Background(), "")
	if err == nil {
		t.Fatal("expected error when catalog service is unavailable")
	}
}

func TestCatalogBuildAddsNamespaceGroups(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "pod-a",
			UID:       "uid-a",
			Scope:     objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)

	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
		namespaceGroups: func() []CatalogNamespaceGroup {
			return []CatalogNamespaceGroup{
				{
					ClusterMeta: ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
					Namespaces:  []string{"default", "kube-system"},
				},
			}
		},
	}

	snap, err := builder.Build(context.Background(), "namespace=default&namespace=kube-system")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if len(payload.NamespaceGroups) != 1 {
		t.Fatalf("expected one namespace group, got %d", len(payload.NamespaceGroups))
	}
	group := payload.NamespaceGroups[0]
	if group.ClusterID != "cluster-a" || group.ClusterName != "alpha" {
		t.Fatalf("unexpected cluster metadata: %+v", group)
	}
	if !reflect.DeepEqual(group.Namespaces, []string{"default", "kube-system"}) {
		t.Fatalf("unexpected namespaces: %+v", group.Namespaces)
	}
	if !reflect.DeepEqual(group.SelectedNamespaces, []string{"default", "kube-system"}) {
		t.Fatalf("unexpected selected namespaces: %+v", group.SelectedNamespaces)
	}
}

func seedCatalogService(t *testing.T, summaries []objectcatalog.Summary) *objectcatalog.Service {
	t.Helper()
	svc := objectcatalog.NewService(objectcatalog.Dependencies{}, nil)
	value := reflect.ValueOf(svc).Elem()

	itemsField := value.FieldByName("items")
	if !itemsField.IsValid() {
		t.Fatal("catalog service items field not found")
	}

	itemsMap := make(map[string]objectcatalog.Summary, len(summaries))
	for idx, summary := range summaries {
		itemsMap[strconv.Itoa(idx)] = summary
	}

	reflect.NewAt(itemsField.Type(), unsafe.Pointer(itemsField.UnsafeAddr())).Elem().Set(reflect.ValueOf(itemsMap))
	return svc
}

func markCatalogCachesReady(t *testing.T, svc *objectcatalog.Service, summaries []objectcatalog.Summary) {
	t.Helper()
	value := reflect.ValueOf(svc).Elem()

	setUnexportedField := func(field reflect.Value, fieldValue interface{}) {
		reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(
			reflect.ValueOf(fieldValue).Convert(field.Type()),
		)
	}

	kindsField := value.FieldByName("cachedKinds")
	if !kindsField.IsValid() {
		t.Fatal("catalog service cachedKinds field not found")
	}
	kindMap := make(map[string]bool, len(summaries))
	for _, summary := range summaries {
		if summary.Kind != "" {
			kindMap[summary.Kind] = summary.Scope == objectcatalog.ScopeNamespace
		}
	}
	kindList := make([]objectcatalog.KindInfo, 0, len(kindMap))
	for kind, namespaced := range kindMap {
		kindList = append(kindList, objectcatalog.KindInfo{Kind: kind, Namespaced: namespaced})
	}
	sort.Slice(kindList, func(i, j int) bool { return kindList[i].Kind < kindList[j].Kind })
	kindsSlice := reflect.MakeSlice(kindsField.Type(), len(kindList), len(kindList))
	for idx, kindInfo := range kindList {
		kindsSlice.Index(idx).Set(reflect.ValueOf(kindInfo))
	}
	setUnexportedField(kindsField, kindsSlice.Interface())

	namespacesField := value.FieldByName("cachedNamespaces")
	if !namespacesField.IsValid() {
		t.Fatal("catalog service cachedNamespaces field not found")
	}
	namespaceSet := make(map[string]struct{}, len(summaries))
	for _, summary := range summaries {
		if summary.Namespace != "" {
			namespaceSet[summary.Namespace] = struct{}{}
		}
	}
	namespaceList := make([]string, 0, len(namespaceSet))
	for ns := range namespaceSet {
		namespaceList = append(namespaceList, ns)
	}
	sort.Strings(namespaceList)
	namespaceSlice := reflect.MakeSlice(namespacesField.Type(), len(namespaceList), len(namespaceList))
	for idx, ns := range namespaceList {
		namespaceSlice.Index(idx).Set(reflect.ValueOf(ns))
	}
	setUnexportedField(namespacesField, namespaceSlice.Interface())

	descriptorsField := value.FieldByName("cachedDescriptors")
	if !descriptorsField.IsValid() {
		t.Fatal("catalog service cachedDescriptors field not found")
	}
	descriptorSlice := reflect.MakeSlice(descriptorsField.Type(), len(summaries), len(summaries))
	for idx, summary := range summaries {
		desc := objectcatalog.Descriptor{
			Group:      summary.Group,
			Version:    summary.Version,
			Resource:   summary.Resource,
			Kind:       summary.Kind,
			Scope:      summary.Scope,
			Namespaced: summary.Scope == objectcatalog.ScopeNamespace,
		}
		descriptorSlice.Index(idx).Set(reflect.ValueOf(desc))
	}
	setUnexportedField(descriptorsField, descriptorSlice.Interface())

	cachesReadyField := value.FieldByName("cachesReady")
	if !cachesReadyField.IsValid() {
		t.Fatal("catalog service cachesReady field not found")
	}
	setUnexportedField(cachesReadyField, true)
}
