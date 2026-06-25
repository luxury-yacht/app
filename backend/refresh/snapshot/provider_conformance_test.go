package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/testsupport"
)

// assertTypedEnvelope verifies a built typed-resource snapshot satisfies the
// normalized envelope contract: it advertises the typed provider, names its
// table, reports completeness, publishes capabilities (visible-row export only),
// and carries rows. This drives the real builders, so it catches a builder that
// forgets to wire Provider/Capabilities/Completeness — which the capability
// helper test (TestTypedResourceProvidersPublishQueryCapabilities) alone
// cannot, because that one only exercises the helper functions in isolation.
func assertTypedEnvelope(t *testing.T, domain string, env ResourceQueryEnvelope, rowCount int) {
	t.Helper()
	if env.Provider != ResourceQueryProviderTypedResource {
		t.Errorf("%s: provider = %q, want %q", domain, env.Provider, ResourceQueryProviderTypedResource)
	}
	if env.Table == "" {
		t.Errorf("%s: table must be set", domain)
	}
	if env.Completeness == "" {
		t.Errorf("%s: completeness must be set", domain)
	}
	if len(env.Capabilities.SortableFields) == 0 {
		t.Errorf("%s: capabilities must publish sortable fields", domain)
	}
	if rowCount == 0 {
		t.Errorf("%s: expected the built snapshot to carry rows", domain)
	}
}

// TestTypedProviderBuildersEmitTheEnvelope drives the real domain builders for
// representative typed providers — the three metrics-coupled domains plus a
// static family — and asserts each built snapshot carries the canonical envelope.
func TestTypedProviderBuildersEmitTheEnvelope(t *testing.T) {
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	t.Run("nodes", func(t *testing.T) {
		node := &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
			Status: corev1.NodeStatus{
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
			},
		}
		builder := newNodeBuilderForTest(
			ClusterMeta{ClusterID: "cluster-a"},
			"",
			fakeMetricsProvider{},
			newFakePodAggregateSource(nil).withNodes(ClusterMeta{ClusterID: "cluster-a"}, "", node),
			node,
		)
		snap, err := builder.Build(ctx, "")
		require.NoError(t, err)
		payload, ok := snap.Payload.(NodeSnapshot)
		require.True(t, ok)
		assertTypedEnvelope(t, "nodes", payload.ResourceQueryEnvelope, len(payload.Rows))
	})

	t.Run("pods", func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default"}}
		builder := &PodBuilder{
			podLister: testsupport.NewPodLister(t, pod),
			rsLister:  testsupport.NewReplicaSetLister(t),
			metrics:   fakeMetricsProvider{},
		}
		snap, err := builder.Build(ctx, "namespace:all")
		require.NoError(t, err)
		payload, ok := snap.Payload.(PodSnapshot)
		require.True(t, ok)
		assertTypedEnvelope(t, "pods", payload.ResourceQueryEnvelope, len(payload.Rows))
	})

	t.Run("namespace-workloads", func(t *testing.T) {
		deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}}
		builder := &NamespaceWorkloadsBuilder{
			podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil),
			includePods:         true,
			workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, deployment),
			includeDeployments:  true,
			includeStatefulSets: true,
			includeDaemonSets:   true,
			includeJobs:         true,
			includeCronJobs:     true,
			metrics:             fakeMetricsProvider{},
		}
		seedWorkloadsFromBuilderSource(builder, ClusterMeta{})
		snap, err := builder.Build(ctx, "namespace:default")
		require.NoError(t, err)
		payload, ok := snap.Payload.(NamespaceWorkloadsSnapshot)
		require.True(t, ok)
		assertTypedEnvelope(t, "namespace-workloads", payload.ResourceQueryEnvelope, len(payload.Rows))
	})

	t.Run("cluster-storage (static family)", func(t *testing.T) {
		pv := &corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "pv-a"}}
		builder := &ClusterStorageBuilder{collectIndexer: clusterStorageCollectIndexer(testsupport.NewClusterIndexer(t, pv))}
		snap, err := builder.Build(ctx, "")
		require.NoError(t, err)
		payload, ok := snap.Payload.(ClusterStorageSnapshot)
		require.True(t, ok)
		assertTypedEnvelope(t, "cluster-storage", payload.ResourceQueryEnvelope, len(payload.Rows))
	})
}

func assertCatalogContract(t *testing.T, label string, p CatalogSnapshot) {
	t.Helper()
	if p.Provider != ResourceQueryProviderCatalog {
		t.Errorf("%s: provider = %q, want %q", label, p.Provider, ResourceQueryProviderCatalog)
	}
	if p.Completeness == "" {
		t.Errorf("%s: completeness must be set", label)
	}
	if len(p.Capabilities.SortableFields) == 0 {
		t.Errorf("%s: catalog must publish sortable fields", label)
	}
}

// TestCatalogBuilderEmitsTheContract covers the catalog provider in both of its
// query modes — Browse (all resources) and Custom (customOnly) — and asserts the
// built snapshot carries the contract fields it surfaces directly (provider,
// completeness, capabilities). Browse additionally must page real rows from
// the seed.
func TestCatalogBuilderEmitsTheContract(t *testing.T) {
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	summaries := []objectcatalog.Summary{
		{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "pod-a", UID: "uid-a", Scope: objectcatalog.ScopeNamespace},
		{Kind: "Deployment", Group: "apps", Version: "v1", Resource: "deployments", Namespace: "default", Name: "deploy-b", UID: "uid-b", Scope: objectcatalog.ScopeNamespace},
	}

	t.Run("browse", func(t *testing.T) {
		svc := seedCatalogService(t, summaries)
		builder := &catalogBuilder{domain: catalogDomain, catalogService: func() *objectcatalog.Service { return svc }}
		snap, err := builder.Build(ctx, "limit=50")
		require.NoError(t, err)
		payload, ok := snap.Payload.(CatalogSnapshot)
		require.True(t, ok)
		assertCatalogContract(t, "browse", payload)
		if len(payload.Items) == 0 {
			t.Error("browse: expected the seeded catalog rows")
		}
	})

	t.Run("custom", func(t *testing.T) {
		// customOnly is a distinct query mode; the contract must hold regardless of
		// how many of the seeded rows are custom-resource-backed.
		svc := seedCatalogService(t, summaries)
		builder := &catalogBuilder{domain: catalogDomain, catalogService: func() *objectcatalog.Service { return svc }}
		snap, err := builder.Build(ctx, "customOnly=true&limit=50")
		require.NoError(t, err)
		payload, ok := snap.Payload.(CatalogSnapshot)
		require.True(t, ok)
		assertCatalogContract(t, "custom", payload)
	})
}

// TestCatalogPaginationIsKeysetNotBatch locks the page-metadata contract: the
// catalog paginates via keyset tokens (Continue/Previous → HasNext/HasPrevious),
// and the batch-streaming fields (BatchIndex/BatchSize/TotalBatches/IsFinal) are
// diagnostics only. The "more pages" signal must be the keyset token, not the
// batch counters — so the resource-inventory controller never consumes
// provider-internal batch readiness as page metadata.
func TestCatalogPaginationIsKeysetNotBatch(t *testing.T) {
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	summaries := []objectcatalog.Summary{
		{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "pod-a", UID: "uid-a", Scope: objectcatalog.ScopeNamespace},
		{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "pod-b", UID: "uid-b", Scope: objectcatalog.ScopeNamespace},
		{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "pod-c", UID: "uid-c", Scope: objectcatalog.ScopeNamespace},
	}
	svc := seedCatalogService(t, summaries)
	builder := &catalogBuilder{domain: catalogDomain, catalogService: func() *objectcatalog.Service { return svc }}
	snap, err := builder.Build(ctx, "limit=1")
	require.NoError(t, err)
	payload, ok := snap.Payload.(CatalogSnapshot)
	require.True(t, ok)

	// Keyset is the pagination contract: a non-empty continue token IS the
	// "more pages" signal, and HasNext mirrors it.
	if payload.Continue == "" {
		t.Fatal("expected a keyset continue token when more rows remain")
	}
	if !payload.HasNext {
		t.Fatal("HasNext must mirror the keyset continue token")
	}
	if payload.Total != 3 {
		t.Fatalf("expected exact total 3, got %d", payload.Total)
	}
	// Batch fields are diagnostics, decided independently of the keyset contract:
	// because a continue token exists, this is not the final batch.
	if payload.IsFinal {
		t.Fatal("a page carrying a continue token must not report IsFinal")
	}
}
