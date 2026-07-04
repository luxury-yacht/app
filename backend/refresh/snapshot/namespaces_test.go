package snapshot

import (
	"context"
	"errors"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/refresh/domain"
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

// TestNamespaceBuilderDoesNotBlockOnUnsyncedIngest proves the namespace list paints without
// waiting for the pod/workload initial LIST. The workload stores never sync, yet with a
// non-cancellable context Build must return promptly (reporting workload presence as unknown)
// rather than blocking until they settle — the ~9s cold-start cost the blocking sync gate used
// to impose on the first build.
func TestNamespaceBuilderDoesNotBlockOnUnsyncedIngest(t *testing.T) {
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "100"},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}
	// Zero value: the five workload stores report HasSyncedFor=false (never sync).
	source := fakePodAggregateSource{}
	builder := &NamespaceBuilder{
		namespaces: testsupport.NewNamespaceLister(t, ns),
		ingest:     source,
		tracker:    NewNamespaceWorkloadTracker(source),
	}

	done := make(chan NamespaceSnapshot, 1)
	go func() {
		snap, err := builder.Build(context.Background(), "")
		if err == nil {
			if payload, ok := snap.Payload.(NamespaceSnapshot); ok {
				done <- payload
			}
		}
	}()

	select {
	case payload := <-done:
		require.Len(t, payload.Namespaces, 1)
		require.True(t, payload.Namespaces[0].WorkloadsUnknown,
			"workload absence must be reported unknown before the ingest stores sync")
	case <-time.After(2 * time.Second):
		t.Fatal("Build blocked waiting for the ingest stores to sync")
	}
}

// TestNamespaceBuilderWorkloadsReadyTracksIngestSync pins the readiness signal the cluster
// lifecycle gate reads: the snapshot's WorkloadsReady is false until the pod/workload ingest
// stores settle and true once they have, so "Ready" means data has loaded (not just that the
// namespace list served immediately).
func TestNamespaceBuilderWorkloadsReadyTracksIngestSync(t *testing.T) {
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "1"}}
	build := func(source fakePodAggregateSource) NamespaceSnapshot {
		builder := &NamespaceBuilder{
			namespaces: testsupport.NewNamespaceLister(t, ns),
			ingest:     source,
			tracker:    NewNamespaceWorkloadTracker(source),
		}
		snap, err := builder.Build(context.Background(), "")
		require.NoError(t, err)
		payload, ok := snap.Payload.(NamespaceSnapshot)
		require.True(t, ok)
		return payload
	}

	// Workload stores not yet synced (zero value) -> not ready.
	require.False(t, build(fakePodAggregateSource{}).WorkloadsReady)

	// Every tracked workload store synced -> ready.
	synced := fakePodAggregateSource{}.
		withWorkloadCatalog(DeploymentGVR, "unused", 0).
		withWorkloadCatalog(StatefulSetGVR, "unused", 0).
		withWorkloadCatalog(DaemonSetGVR, "unused", 0).
		withWorkloadCatalog(JobGVR, "unused", 0).
		withWorkloadCatalog(CronJobGVR, "unused", 0)
	require.True(t, build(synced).WorkloadsReady)
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

// --- Scoped ("accessible namespaces") mode, docs/plans/namespace-scope.md ---

func TestNamespaceBuilderScopedSynthesizesConfiguredNames(t *testing.T) {
	// Pre-Phase-4 restricted cluster: no lister (cluster-wide list denied), no
	// ingest data at all. Rows come from the configured scope; workload
	// presence is genuinely unknown, so nothing may render as
	// authoritatively-empty (dimmed).
	builder := &NamespaceBuilder{scope: []string{"prod", "dev"}}

	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "prod-cluster"})
	snap, err := builder.Build(ctx, "")
	require.NoError(t, err)

	payload, ok := snap.Payload.(NamespaceSnapshot)
	require.True(t, ok)
	require.True(t, payload.WorkloadsReady, "scoped snapshot must satisfy the lifecycle Ready gate")
	require.Len(t, payload.Namespaces, 2)
	require.Equal(t, "dev", payload.Namespaces[0].Name)
	require.Equal(t, "prod", payload.Namespaces[1].Name)

	for _, ns := range payload.Namespaces {
		require.False(t, ns.HasWorkloads)
		require.True(t, ns.WorkloadsUnknown, "no tracked workload kind: presence must be unknown, not authoritatively empty")
		require.Equal(t, "Namespace", ns.Ref.Kind)
		require.Equal(t, "namespaces", ns.Ref.Resource)
		require.Equal(t, ns.Name, ns.Ref.Name)
		require.Equal(t, "cluster-a", ns.Ref.ClusterID)
	}
}

func TestNamespaceBuilderScopedReportsPresenceOnceIngestTracksWorkloads(t *testing.T) {
	// Post-Phase-4 scoped cluster: ingest tracks workload kinds and has rows
	// for one configured namespace. Presence becomes known for every row.
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	builder := &NamespaceBuilder{
		scope:   []string{"prod", "dev"},
		ingest:  fakePodAggregateSource{}.withWorkloadCatalog(DeploymentGVR, "prod", 1),
		tracker: tracker,
	}

	snap, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snap.Payload.(NamespaceSnapshot)
	require.Len(t, payload.Namespaces, 2)

	byName := map[string]NamespaceSummary{}
	for _, ns := range payload.Namespaces {
		byName[ns.Name] = ns
	}
	require.True(t, byName["prod"].HasWorkloads)
	require.False(t, byName["prod"].WorkloadsUnknown)
	require.False(t, byName["dev"].HasWorkloads)
	require.False(t, byName["dev"].WorkloadsUnknown, "tracked ingest makes absence authoritative")
}

func TestNamespaceBuilderScopedViewScopeFiltersToConfiguredNames(t *testing.T) {
	builder := &NamespaceBuilder{scope: []string{"prod", "dev"}}

	snap, err := builder.Build(context.Background(), "cluster-a|prod")
	require.NoError(t, err)
	payload := snap.Payload.(NamespaceSnapshot)
	require.Len(t, payload.Namespaces, 1)
	require.Equal(t, "prod", payload.Namespaces[0].Name)

	snap, err = builder.Build(context.Background(), "cluster-a|not-configured")
	require.NoError(t, err)
	payload = snap.Payload.(NamespaceSnapshot)
	require.Empty(t, payload.Namespaces)
}

func TestRegisterNamespaceDomainScopedDoesNotTouchNamespaceInformer(t *testing.T) {
	// A scoped identity typically cannot list/watch namespaces cluster-wide;
	// the scoped registration must never instantiate the namespaces informer.
	// Passing a nil factory proves it: any touch would panic.
	reg := domain.New()
	notifier, err := RegisterNamespaceDomain(reg, nil, nil, []string{"prod"}, nil)
	require.NoError(t, err)
	require.NotNil(t, notifier)
}

// Scoped rows are enriched by a per-namespace GET probe
// (docs/plans/namespace-scope.md, Phase 5): a real namespace serves its full
// row; a 404 flags "not-found" (definitive — the GET was permitted); a 403
// flags "no-access" (a restricted identity cannot distinguish absence from
// denial, so the label stays honest).
func TestNamespaceBuilderScopedProbesEnrichAndFlagRows(t *testing.T) {
	created := time.Unix(1700000000, 0).UTC()
	realNs := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "prod",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(created),
		},
		Status: corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}
	client := k8sfake.NewClientset(realNs)
	client.PrependReactor("get", "namespaces", func(action clienttesting.Action) (bool, runtime.Object, error) {
		if action.(clienttesting.GetAction).GetName() == "locked" {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "namespaces"}, "locked", errors.New("denied"))
		}
		return false, nil, nil
	})

	builder := &NamespaceBuilder{
		scope:  []string{"prod", "ghost", "locked"},
		client: client,
	}

	snap, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snap.Payload.(NamespaceSnapshot)
	require.Len(t, payload.Namespaces, 3)

	byName := map[string]NamespaceSummary{}
	for _, ns := range payload.Namespaces {
		byName[ns.Name] = ns
	}

	prod := byName["prod"]
	require.Empty(t, prod.ScopeStatus, "an existing accessible namespace carries no flag")
	require.Equal(t, "Active", prod.Phase, "probe enriches the row from the real object")
	require.Equal(t, "42", prod.ResourceVersion)
	require.Equal(t, created.Unix(), prod.CreationUnix)

	require.Equal(t, "not-found", byName["ghost"].ScopeStatus,
		"a permitted GET returning 404 is definitive")
	require.Equal(t, "no-access", byName["locked"].ScopeStatus,
		"403 is honest: may not exist or may be denied")
}

func TestNamespaceBuilderScopedProbeCacheAndValidator(t *testing.T) {
	gets := 0
	client := k8sfake.NewClientset()
	client.PrependReactor("get", "namespaces", func(action clienttesting.Action) (bool, runtime.Object, error) {
		gets++
		return false, nil, nil
	})

	now := time.Unix(1700000000, 0)
	builder := &NamespaceBuilder{
		scope:  []string{"ghost"},
		client: client,
		now:    func() time.Time { return now },
	}

	snapA, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, 1, gets)
	_, err = builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, 1, gets, "within the TTL the probe result is cached")

	// The namespace is created; past the TTL the probe re-asks and the
	// snapshot's cache validator must change (the row content changed with
	// no namespace-RV clock to carry it).
	require.NoError(t, client.Tracker().Add(&corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "ghost", ResourceVersion: "7"},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}))
	now = now.Add(time.Hour)

	snapB, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, 2, gets, "past the TTL the probe re-asks")
	require.Empty(t, snapB.Payload.(NamespaceSnapshot).Namespaces[0].ScopeStatus)
	require.NotEqual(t, snapA.SourceVersions["scope-probe"], snapB.SourceVersions["scope-probe"],
		"probe transitions must change the cache validator or the client keeps the stale flag")
}
