package snapshot

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

func wlDeployment(name, namespace, rv string, ready, total int32) *appsv1.Deployment {
	replicas := total
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, CreationTimestamp: metav1.NewTime(time.Unix(1_700_000_000, 0))},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas, Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": name}}},
		Status:     appsv1.DeploymentStatus{ReadyReplicas: ready, Replicas: total},
	}
}

func wlPod(name, namespace, rv string, ownerRSName string, restarts int32) *corev1.Pod {
	ctrl := true
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, ResourceVersion: rv, CreationTimestamp: metav1.NewTime(time.Unix(1_700_000_100, 0))},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{Name: "c", Ready: true, RestartCount: restarts}},
		},
	}
	if ownerRSName != "" {
		pod.OwnerReferences = []metav1.OwnerReference{{Kind: "ReplicaSet", Name: ownerRSName, Controller: &ctrl}}
	}
	return pod
}

// seedWorkloadsMaintained wires a fresh Sink-fed maintained store onto the builder and feeds it
// the workload OWN-rows the supplied fake ingest source carries — exactly the production wiring
// (each GVR's Table-half WorkloadSummary delivered to the one store's Sink, RegisterNamespace
// WorkloadsDomain's AddSink-per-GVR). After seeding, Build serves own-rows from the store and
// re-joins pods/metrics/HPA + synthesizes standalone pods at serve.
func seedWorkloadsMaintained(b *NamespaceWorkloadsBuilder, meta ClusterMeta, src fakeWorkloadIngestSource) {
	b.workloadsMaintained = newTypedMaintainedStore(meta, workloadsQuerypageSchema(), workloadTableQueryAdapter())
	sink := b.workloadsMaintained.Sink()
	for _, gvr := range []schema.GroupVersionResource{DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR} {
		for _, raw := range src.Rows(gvr) {
			bundle, ok := raw.(ingest.Bundle)
			if !ok {
				continue
			}
			if row, ok := bundle.Table.(WorkloadSummary); ok {
				sink.Upsert(row)
			}
		}
	}
}

// seedWorkloadsFromBuilderSource feeds the builder's Sink-fed maintained store from the fake
// workload ingest source the builder already holds — the one-line conversion for a direct-builder
// unit test that previously relied on the (now-removed) PULL read of own-rows. It mirrors
// RegisterNamespaceWorkloadsDomain: the workload own-rows flow through the store's Sink, then Build
// serves them. meta stamps the store's cluster identity (the rows carry their own ClusterMeta from
// the projector).
func seedWorkloadsFromBuilderSource(b *NamespaceWorkloadsBuilder, meta ClusterMeta) {
	src, ok := b.workloadIngest.(fakeWorkloadIngestSource)
	if !ok {
		return
	}
	seedWorkloadsMaintained(b, meta, src)
}

// TestNamespaceWorkloadsBuilderMaintainedMatchesListPath is the workloads maintained-store
// cutover gate: a builder serving workload OWN-rows from the Sink-fed maintained store (re-joining
// pods/metrics/HPA + synthesizing standalone pods at serve) must produce the byte-identical
// NamespaceWorkloadsSnapshot a builder serving own-rows directly from the same projected rows
// produces — across namespace + query scopes, WITH a non-empty metrics sample so the serve overlay
// is exercised (workload rows via reaggregate, standalone rows rebuilt). Both builders are wired
// identically; the gate proves the Sink-fed store holds the same own-rows the projectors emit.
func TestNamespaceWorkloadsBuilderMaintainedMatchesListPath(t *testing.T) {
	meta := ClusterMeta{}
	dep := wlDeployment("web", "default", "100", 1, 2)
	ownedPod := wlPod("web-123", "default", "201", "web-123", 0) // RS web-123 -> deployment web
	standalonePod := wlPod("loner", "default", "202", "", 3)     // no owner -> standalone
	otherNsPod := wlPod("solo", "kube-system", "203", "", 1)     // standalone in another ns

	mk := func() *NamespaceWorkloadsBuilder {
		src := newFakeWorkloadIngestSource(meta, dep)
		b := &NamespaceWorkloadsBuilder{
			podIngest:           newFakePodWorkloadsIngestSource(meta, nil, ownedPod, standalonePod, otherNsPod),
			includePods:         true,
			workloadIngest:      src,
			includeDeployments:  true,
			includeStatefulSets: true,
			includeDaemonSets:   true,
			includeJobs:         true,
			includeCronJobs:     true,
		}
		seedWorkloadsMaintained(b, meta, src)
		return b
	}
	a := mk()
	b := mk()

	scopes := []string{
		"namespace:all",
		"namespace:default",
		"namespace:kube-system",
		"namespace:all?sortField=name&sortDirection=asc&limit=2",
		"namespace:all?sortField=cpu&sortDirection=desc",
	}
	for _, scope := range scopes {
		as, err := a.Build(context.Background(), scope)
		require.NoError(t, err, "build a %q", scope)
		bs, err := b.Build(context.Background(), scope)
		require.NoError(t, err, "build b %q", scope)
		require.Equal(t,
			as.Payload.(NamespaceWorkloadsSnapshot),
			bs.Payload.(NamespaceWorkloadsSnapshot),
			"scope %q: the two Sink-fed builds must be equal", scope)
	}
}

func TestNamespaceWorkloadsMaintainedAppliesProviderFacetAndKeepsOptionsStable(t *testing.T) {
	meta := ClusterMeta{}
	ready := wlDeployment("ready", "default", "100", 2, 2)
	progressing := wlDeployment("progressing", "default", "101", 0, 2)
	src := newFakeWorkloadIngestSource(meta, ready, progressing)
	builder := &NamespaceWorkloadsBuilder{
		workloadIngest:     src,
		includeDeployments: true,
	}
	seedWorkloadsMaintained(builder, meta, src)

	base, err := builder.Build(context.Background(), "namespace:all?limit=50")
	require.NoError(t, err)
	basePayload := base.Payload.(NamespaceWorkloadsSnapshot)
	options := testFacetOptionValues(basePayload.FacetValues, "statuses")
	require.Len(t, options, 2)

	selected := options[0]
	filtered, err := builder.Build(context.Background(), "namespace:all?limit=50&facet.statuses="+selected)
	require.NoError(t, err)
	filteredPayload := filtered.Payload.(NamespaceWorkloadsSnapshot)
	require.NotEmpty(t, filteredPayload.Rows)
	for _, row := range filteredPayload.Rows {
		require.Equal(t, selected, row.Status)
	}
	require.Equal(t, options, testFacetOptionValues(filteredPayload.FacetValues, "statuses"))

}

// TestNamespaceWorkloadsMaintainedOwnedPodNeverStandalone pins the workloads-view rule: the view
// shows workload OWN-rows plus pods that have NO controller owner. A pod with a controller owner
// must never appear as its own row — not even when its owning workload is absent from the emitted
// set (owner removed, filtered by permission, or owned by an untracked kind). A bare pod (no owner)
// is always emitted, independent of the workload set.
func TestNamespaceWorkloadsMaintainedOwnedPodNeverStandalone(t *testing.T) {
	meta := ClusterMeta{}
	dep := wlDeployment("web", "default", "100", 1, 1)
	ownedPod := wlPod("web-123", "default", "201", "web-123", 0) // controller-owned -> never a row
	barePod := wlPod("loner", "default", "202", "", 0)           // no owner -> always a row

	rowKeys := func(rows []WorkloadSummary) []string {
		keys := make([]string, len(rows))
		for i, r := range rows {
			keys[i] = r.Kind + "/" + r.Namespace + "/" + r.Name
		}
		return keys
	}

	src := newFakeWorkloadIngestSource(meta, dep)
	b := &NamespaceWorkloadsBuilder{
		podIngest:          newFakePodWorkloadsIngestSource(meta, nil, ownedPod, barePod),
		includePods:        true,
		workloadIngest:     src,
		includeDeployments: true,
	}
	seedWorkloadsMaintained(b, meta, src)

	// Deployment present: the Deployment row plus the bare pod row. web-123 is folded into the
	// Deployment, never shown on its own.
	snap, err := b.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	rows := snap.Payload.(NamespaceWorkloadsSnapshot).Rows
	require.ElementsMatch(t, []string{"Deployment/default/web", "Pod/default/loner"}, rowKeys(rows))

	// Remove the deployment from the store: web-123 still must NOT surface as a standalone row — it
	// has an owner. Only the bare pod remains.
	emptySrc := newFakeWorkloadIngestSource(meta)
	seedWorkloadsMaintained(b, meta, emptySrc)
	b.workloadIngest = emptySrc
	snap, err = b.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	rows = snap.Payload.(NamespaceWorkloadsSnapshot).Rows
	require.ElementsMatch(t, []string{"Pod/default/loner"}, rowKeys(rows))
}

// TestWorkloadsStoreRelistPreservesOtherKinds pins the multi-kind maintained-store contract: the
// five workload kinds share ONE store, fed by five reflector GVRs. A relist of one GVR's reflector
// (initial list / periodic resync) delivers ReplaceBundles carrying ONLY that GVR's kind; it must
// replace only that kind's rows and leave the other kinds untouched. The unscoped BundleSink()
// replaced the WHOLE store on every relist, so whichever workload GVR relisted last won and the
// other four kinds vanished — the "StatefulSets missing" bug.
func TestWorkloadsStoreRelistPreservesOtherKinds(t *testing.T) {
	meta := ClusterMeta{}
	store := newTypedMaintainedStore(meta, workloadsQuerypageSchema(), workloadTableQueryAdapter())

	depBundle := workloadBundle(t, NewDeploymentIngestProjector(meta), wlDeployment("web", "default", "100", 1, 1))
	stsBundle := workloadBundle(t, NewStatefulSetIngestProjector(meta), &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "cache", Namespace: "default", ResourceVersion: "200"},
		Spec: appsv1.StatefulSetSpec{
			Replicas: ptrInt32(1),
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}}},
		},
	})

	depSink := store.bundleSinkForKind("Deployment")
	stsSink := store.bundleSinkForKind("StatefulSet")

	// Both kinds present after their reflectors' initial upserts.
	depSink.UpsertBundle(depBundle)
	stsSink.UpsertBundle(stsBundle)
	require.ElementsMatch(t, []string{"Deployment", "StatefulSet"}, workloadStoreKinds(store))

	// The Deployment GVR's reflector relists with only its own kind's bundles.
	depSink.(ingest.BundleReplaceSink).ReplaceBundles([]ingest.Bundle{depBundle})

	// The StatefulSet row must survive a Deployment relist.
	require.ElementsMatch(t, []string{"Deployment", "StatefulSet"}, workloadStoreKinds(store))
}

func workloadBundle(t *testing.T, project ingest.ProjectFunc, obj interface{}) ingest.Bundle {
	t.Helper()
	raw, err := project(obj)
	require.NoError(t, err)
	bundle, ok := raw.(ingest.Bundle)
	require.True(t, ok, "projector returned %T, want ingest.Bundle", raw)
	return bundle
}

func workloadStoreKinds(store *typedMaintainedStore[WorkloadSummary]) []string {
	available := map[string]bool{"Deployment": true, "StatefulSet": true, "DaemonSet": true, "Job": true, "CronJob": true}
	rows := store.rows("", available)
	kinds := make([]string, len(rows))
	for i, r := range rows {
		kinds[i] = r.Kind
	}
	return kinds
}

// TestWorkloadsMaintainedStoreSpillRestoreRoundTrip proves the workloads maintained store — the
// per-cluster store of workload OWN-rows fed by the five workload GVRs' Table-half Sinks — spills
// to disk and restores into a fresh store with identical rows (the warm-paint capability the
// governor's Cold/re-warm uses). It goes through the workloads schema + adapter, so it proves the
// workload store wiring round-trips, mirroring TestNodeMaintainedStoreSpillRestoreRoundTrip.
func TestWorkloadsMaintainedStoreSpillRestoreRoundTrip(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	available := map[string]bool{"Deployment": true, "StatefulSet": true}

	src := newFakeWorkloadIngestSource(meta,
		wlDeployment("web", "default", "1", 1, 1),
		wlDeployment("api", "staging", "2", 1, 2),
		&appsv1.StatefulSet{
			ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default", ResourceVersion: "3"},
			Spec:       appsv1.StatefulSetSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "db"}}}}},
		},
	)

	orig := newTypedMaintainedStore(meta, workloadsQuerypageSchema(), workloadTableQueryAdapter())
	sink := orig.Sink()
	for _, gvr := range []schema.GroupVersionResource{DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR} {
		for _, raw := range src.Rows(gvr) {
			if bundle, ok := raw.(ingest.Bundle); ok {
				if row, ok := bundle.Table.(WorkloadSummary); ok {
					sink.Upsert(row)
				}
			}
		}
	}

	path := filepath.Join(t.TempDir(), "workloads.spill")
	require.NoError(t, orig.SpillTo(path))

	restored := newTypedMaintainedStore(meta, workloadsQuerypageSchema(), workloadTableQueryAdapter())
	require.NoError(t, restored.RestoreFrom(path))

	require.ElementsMatch(t, orig.rows("", available), restored.rows("", available),
		"restored workloads maintained store must hold the same own-rows as the spilled one")
}
