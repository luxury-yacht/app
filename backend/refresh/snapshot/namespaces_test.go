package snapshot

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
)

func TestNamespaceBuilderSortsByName(t *testing.T) {
	nsB := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "beta", ResourceVersion: "2"}}
	nsA := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "1"}}

	builder := &NamespaceBuilder{namespaces: testsupport.NewNamespaceLister(t, nsB, nsA)}

	snap, err := builder.Build(context.Background(), "")
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}

	payload, ok := snap.Payload.(NamespaceSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if len(payload.Namespaces) != 2 {
		t.Fatalf("expected 2 namespaces, got %d", len(payload.Namespaces))
	}

	if payload.Namespaces[0].Name != "alpha" || payload.Namespaces[1].Name != "beta" {
		t.Fatalf("expected namespaces sorted by name, got %v", []string{payload.Namespaces[0].Name, payload.Namespaces[1].Name})
	}

	for _, ns := range payload.Namespaces {
		if ns.WorkloadsUnknown {
			t.Fatalf("expected workloads unknown to be false for namespace %s", ns.Name)
		}
		if ns.StatusState == "" || ns.StatusPresentation == "" {
			t.Fatalf("expected namespace status projection for %s, got state=%q presentation=%q", ns.Name, ns.StatusState, ns.StatusPresentation)
		}
	}
}

func TestNamespaceBuilderScopePayloadIdentityAndCatalogProjectionContract(t *testing.T) {
	created := time.Unix(1700000000, 0).UTC()
	nsAlpha := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "alpha",
			UID:               types.UID("namespace-alpha"),
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(created),
		},
		Status: corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}
	nsBeta := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "beta", ResourceVersion: "43"},
	}
	builder := &NamespaceBuilder{namespaces: testsupport.NewNamespaceLister(t, nsAlpha, nsBeta)}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{
		ClusterID:   "cluster-a",
		ClusterName: "prod",
	})

	snap, err := builder.Build(ctx, "cluster-a|alpha")
	require.NoError(t, err)
	require.Equal(t, "namespaces", snap.Domain)
	require.Equal(t, "cluster-a|alpha", snap.Scope)
	require.Equal(t, uint64(42), snap.Version)
	require.Equal(t, 1, snap.Stats.ItemCount)

	payload, ok := snap.Payload.(NamespaceSnapshot)
	require.True(t, ok)
	require.Equal(t, "cluster-a", payload.ClusterID)
	require.Equal(t, "prod", payload.ClusterName)
	require.Len(t, payload.Namespaces, 1)

	summary := payload.Namespaces[0]
	require.Equal(t, "cluster-a", summary.ClusterID)
	require.Equal(t, "prod", summary.ClusterName)
	require.Equal(t, "alpha", summary.Name)
	require.Equal(t, "Active", summary.Phase)
	require.Equal(t, "42", summary.ResourceVersion)
	require.Equal(t, created.Unix(), summary.CreationUnix)
	require.Equal(t, "ready", summary.StatusPresentation)

	require.Equal(t, "cluster-a", summary.Ref.ClusterID)
	require.Equal(t, "", summary.Ref.Group)
	require.Equal(t, "v1", summary.Ref.Version)
	require.Equal(t, "Namespace", summary.Ref.Kind)
	require.Equal(t, "namespaces", summary.Ref.Resource)
	require.Equal(t, "", summary.Ref.Namespace)
	require.Equal(t, "alpha", summary.Ref.Name)
	require.Equal(t, "namespace-alpha", summary.Ref.UID)
}

func TestNamespaceBuilderReportsWorkloadsFromSyncedIngestStore(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "100"},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}

	builder := &NamespaceBuilder{
		namespaces: testsupport.NewNamespaceLister(t, ns),
		// Workload presence comes from the synced ingest store — the same projected rows Browse reads.
		ingest:  fakePodAggregateSource{}.withWorkloadCatalog(DeploymentGVR, "alpha", 1),
		tracker: tracker,
	}

	snap, err := builder.Build(context.Background(), "")
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}

	payload, ok := snap.Payload.(NamespaceSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if len(payload.Namespaces) != 1 {
		t.Fatalf("expected one namespace, got %d", len(payload.Namespaces))
	}

	summary := payload.Namespaces[0]
	if !summary.HasWorkloads {
		t.Fatalf("expected HasWorkloads true from the ingest store")
	}
	if summary.WorkloadsUnknown {
		t.Fatalf("expected WorkloadsUnknown false when the stores are synced")
	}
	if summary.Status != "Active" || summary.StatusState != "Active" || summary.StatusPresentation != "ready" {
		t.Fatalf("expected shared namespace status projection, got %#v", summary)
	}
}

func TestNamespaceBuilderDoesNotDimWhenTrackerMissesButIngestHasWorkloads(t *testing.T) {
	// Fresh-connect failure the fix targets: the ingest store HAS the namespace's workloads
	// (Browse reads the same CatalogRows and shows them), but the tracker's (old) incremental
	// map never recorded the namespace. The builder must read workload presence from the
	// authoritative ingest store, so a tracker-map miss can never dim a namespace that has
	// workloads.
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true) // synced, but no incremental map records "alpha"

	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "100"},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}

	builder := &NamespaceBuilder{
		namespaces: testsupport.NewNamespaceLister(t, ns),
		// The authoritative ingest store has a Deployment in "alpha" — exactly what Browse shows.
		ingest:  fakePodAggregateSource{}.withWorkloadCatalog(DeploymentGVR, "alpha", 1),
		tracker: tracker,
	}

	snap, err := builder.Build(context.Background(), "")
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	payload, ok := snap.Payload.(NamespaceSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if len(payload.Namespaces) != 1 {
		t.Fatalf("expected one namespace, got %d", len(payload.Namespaces))
	}
	if !payload.Namespaces[0].HasWorkloads {
		t.Fatalf("namespace dimmed despite the ingest store holding its workloads")
	}
	if payload.Namespaces[0].WorkloadsUnknown {
		t.Fatalf("expected workloadsUnknown false once the stores are synced")
	}
}

func TestNamespaceBuilderReportsWorkloadsUnknownWhenIngestNotSyncedAndNoRows(t *testing.T) {
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "100"},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}
	source := fakePodAggregateSource{}
	builder := &NamespaceBuilder{
		namespaces: testsupport.NewNamespaceLister(t, ns),
		ingest:     source,
		tracker:    NewNamespaceWorkloadTracker(source),
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	snap, err := builder.Build(ctx, "")
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	payload, ok := snap.Payload.(NamespaceSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if len(payload.Namespaces) != 1 {
		t.Fatalf("expected one namespace, got %d", len(payload.Namespaces))
	}
	if payload.Namespaces[0].HasWorkloads {
		t.Fatalf("expected no positive workload evidence before ingest sync")
	}
	if !payload.Namespaces[0].WorkloadsUnknown {
		t.Fatalf("expected workload absence to remain unknown before ingest sync")
	}
}

func TestNamespaceBuilderWorkloadPresenceChangesSourceVersion(t *testing.T) {
	// The per-namespace workload flag is content the namespace resourceVersions do not capture.
	// A change in workload presence must change the snapshot's "workloads" source clock, so the
	// delivery layer's validator differs and the corrected snapshot is delivered instead of
	// returning 304 Not Modified — the bug that left a stale (pre-sync) snapshot on screen.
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "1"}}

	workloadsSourceVersion := func(catalogCount int) string {
		tracker := newNamespaceWorkloadTracker()
		tracker.synced.Store(true)
		builder := &NamespaceBuilder{
			namespaces: testsupport.NewNamespaceLister(t, ns),
			ingest:     fakePodAggregateSource{}.withWorkloadCatalog(DeploymentGVR, "alpha", catalogCount),
			tracker:    tracker,
		}
		snap, err := builder.Build(context.Background(), "")
		if err != nil {
			t.Fatalf("build failed: %v", err)
		}
		return snap.SourceVersions["workloads"]
	}

	withWorkloads := workloadsSourceVersion(1)
	withoutWorkloads := workloadsSourceVersion(0)
	if withWorkloads == "" {
		t.Fatalf("expected a workloads source version to be published")
	}
	if withWorkloads == withoutWorkloads {
		t.Fatalf("workload presence change did not change the workloads source version (%q) — the correction would be 304'd", withWorkloads)
	}
}

func TestNamespaceBuilderWorkloadSyncReadinessChangesSourceVersion(t *testing.T) {
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "1"}}
	workloadsSourceVersion := func(source fakePodAggregateSource, cancelBeforeBuild bool) string {
		builder := &NamespaceBuilder{
			namespaces: testsupport.NewNamespaceLister(t, ns),
			ingest:     source,
			tracker:    NewNamespaceWorkloadTracker(source),
		}
		ctx := context.Background()
		if cancelBeforeBuild {
			cancelled, cancel := context.WithCancel(ctx)
			cancel()
			ctx = cancelled
		}
		snap, err := builder.Build(ctx, "")
		if err != nil {
			t.Fatalf("build failed: %v", err)
		}
		return snap.SourceVersions["workloads"]
	}

	notReady := workloadsSourceVersion(fakePodAggregateSource{}, true)
	ready := workloadsSourceVersion(
		fakePodAggregateSource{}.
			withWorkloadCatalog(DeploymentGVR, "unused", 0).
			withWorkloadCatalog(StatefulSetGVR, "unused", 0).
			withWorkloadCatalog(DaemonSetGVR, "unused", 0).
			withWorkloadCatalog(JobGVR, "unused", 0).
			withWorkloadCatalog(CronJobGVR, "unused", 0),
		false,
	)
	if notReady == "" || ready == "" {
		t.Fatalf("expected workload source versions, got notReady=%q ready=%q", notReady, ready)
	}
	if notReady == ready {
		t.Fatalf("workload sync readiness did not change the workloads source version (%q)", ready)
	}
}
