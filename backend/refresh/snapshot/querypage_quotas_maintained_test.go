package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
)

// TestQuotasMaintainedStoreSinkMatchesListPath is the SAFETY GATE for the live
// ingest cutover: fed the same StreamRow rows through the ingest Sink (the live
// reflector path), the maintained store's rows must equal exactly what the current
// list path produces, for every namespace scope. The sink delivers the projected
// QuotaSummary directly (the bundle's Table half), so this exercises the exact
// adapter the IngestManager feeds in production.
func TestQuotasMaintainedStoreSinkMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	quotaDesc := quotasDescriptor(t, "resourcequotas")
	limitDesc := quotasDescriptor(t, "limitranges")
	pdbDesc := quotasDescriptor(t, "poddisruptionbudgets")

	quotas := []*corev1.ResourceQuota{
		quotaObj("default", "alpha", "1"),
		quotaObj("app", "beta", "2"),
	}
	limits := []*corev1.LimitRange{
		limitObj("default", "gamma", "3"),
		limitObj("kube-system", "delta", "4"),
	}
	pdbs := []*policyv1.PodDisruptionBudget{
		pdbObj("default", "epsilon", "5", 1),
		pdbObj("kube-system", "zeta", "6", 2),
	}

	quotaIdx := newNamespaceIndexer()
	limitIdx := newNamespaceIndexer()
	pdbIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, quotasQuerypageSchema(), quotaTableQueryAdapter())
	sink := store.Sink()
	// Feed via the sink with the StreamRow output — exactly what the bundle's Table
	// half delivers from the reflector. Each kind's descriptor projects its object.
	for _, q := range quotas {
		require.NoError(t, quotaIdx.Add(q))
		sink.Upsert(quotaDesc.StreamRow(meta, q))
	}
	for _, l := range limits {
		require.NoError(t, limitIdx.Add(l))
		sink.Upsert(limitDesc.StreamRow(meta, l))
	}
	for _, p := range pdbs {
		require.NoError(t, pdbIdx.Add(p))
		sink.Upsert(pdbDesc.StreamRow(meta, p))
	}

	collect := quotasCollectIndexer(quotaIdx, limitIdx, pdbIdx)
	available := map[string]bool{"ResourceQuota": true, "LimitRange": true, "PodDisruptionBudget": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[QuotaSummary](
			context.Background(), namespaceQuotasDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"sink-fed maintained store rows must equal the list path for namespace %q", ns)
	}

	// A delete through the sink evicts the row, exactly like a watch delete.
	sink.Delete(limitDesc.StreamRow(meta, limits[0]))
	require.Nil(t, findQuotaRow(store.rows("default", available), "LimitRange", "default", "gamma"))
	// Version advances monotonically as the sink mutates the store.
	require.Greater(t, store.snapshotVersion(), uint64(0), "sink mutations advance the snapshot version")
}

func quotaObj(ns, name, rv string) *corev1.ResourceQuota {
	return &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("5")},
		},
	}
}

func limitObj(ns, name, rv string) *corev1.LimitRange {
	return &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Spec:       corev1.LimitRangeSpec{Limits: []corev1.LimitRangeItem{{Type: corev1.LimitTypePod}}},
	}
}

func pdbObj(ns, name, rv string, minAvail int) *policyv1.PodDisruptionBudget {
	ma := intstr.FromInt(minAvail)
	return &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Spec:       policyv1.PodDisruptionBudgetSpec{MinAvailable: &ma},
		Status:     policyv1.PodDisruptionBudgetStatus{CurrentHealthy: 1, DesiredHealthy: 2, DisruptionsAllowed: 1},
	}
}

func findQuotaRow(rows []QuotaSummary, kind, ns, name string) *QuotaSummary {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Namespace == ns && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func quotasDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceQuotasDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no namespace-quotas descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

// TestQuotasMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary.
func TestQuotasMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	quotaDesc := quotasDescriptor(t, "resourcequotas")
	limitDesc := quotasDescriptor(t, "limitranges")
	pdbDesc := quotasDescriptor(t, "poddisruptionbudgets")
	store := newTypedMaintainedStore(meta, quotasQuerypageSchema(), quotaTableQueryAdapter())
	available := map[string]bool{"ResourceQuota": true, "LimitRange": true, "PodDisruptionBudget": true}

	store.ingest(quotaDesc, quotaObj("default", "q-a", "10"))
	store.ingest(limitDesc, limitObj("default", "l-a", "12"))
	store.ingest(pdbDesc, pdbObj("kube-system", "p-a", "8", 1))
	store.ingest(quotaDesc, quotaObj("default", "q-b", "15"))

	require.Equal(t, uint64(15), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("default", available), 3)
	require.Len(t, store.rows("", available), 4)
	require.Len(t, store.rows("kube-system", available), 1)

	want := resourcequota.BuildStreamSummary(meta, quotaObj("default", "q-a", "10"))
	got := findQuotaRow(store.rows("default", available), "ResourceQuota", "default", "q-a")
	require.NotNil(t, got, "q-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// Update q-a in place: new resourceVersion, no duplicate.
	store.ingest(quotaDesc, quotaObj("default", "q-a", "20"))
	require.Equal(t, uint64(20), store.snapshotVersion())
	require.Len(t, store.rows("default", available), 3, "in-place update, no duplicate")

	// Delete l-a directly; delete p-a via a tombstone.
	store.evict(limitDesc, limitObj("default", "l-a", "21"))
	store.evict(pdbDesc, cache.DeletedFinalStateUnknown{Key: "kube-system/p-a", Obj: pdbObj("kube-system", "p-a", "22", 1)})
	require.Nil(t, findQuotaRow(store.rows("default", available), "LimitRange", "default", "l-a"))
	require.Nil(t, findQuotaRow(store.rows("kube-system", available), "PodDisruptionBudget", "kube-system", "p-a"))
	require.Len(t, store.rows("default", available), 2, "q-a and q-b remain in default")
}

// TestQuotasMaintainedStoreMatchesListPath is the SAFETY GATE for the live cutover:
// fed the same objects, the maintained store's rows must equal exactly what the
// current list path produces, for every namespace scope.
func TestQuotasMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	quotaDesc := quotasDescriptor(t, "resourcequotas")
	limitDesc := quotasDescriptor(t, "limitranges")
	pdbDesc := quotasDescriptor(t, "poddisruptionbudgets")

	quotas := []*corev1.ResourceQuota{
		quotaObj("default", "alpha", "1"),
		quotaObj("app", "beta", "2"),
	}
	limits := []*corev1.LimitRange{
		limitObj("default", "gamma", "3"),
		limitObj("kube-system", "delta", "4"),
	}
	pdbs := []*policyv1.PodDisruptionBudget{
		pdbObj("default", "epsilon", "5", 1),
		pdbObj("kube-system", "zeta", "6", 2),
	}

	quotaIdx := newNamespaceIndexer()
	limitIdx := newNamespaceIndexer()
	pdbIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, quotasQuerypageSchema(), quotaTableQueryAdapter())
	for _, q := range quotas {
		require.NoError(t, quotaIdx.Add(q))
		store.ingest(quotaDesc, q)
	}
	for _, l := range limits {
		require.NoError(t, limitIdx.Add(l))
		store.ingest(limitDesc, l)
	}
	for _, p := range pdbs {
		require.NoError(t, pdbIdx.Add(p))
		store.ingest(pdbDesc, p)
	}

	collect := quotasCollectIndexer(quotaIdx, limitIdx, pdbIdx)
	available := map[string]bool{"ResourceQuota": true, "LimitRange": true, "PodDisruptionBudget": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[QuotaSummary](
			context.Background(), namespaceQuotasDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"maintained store rows must equal the list path for namespace %q", ns)
	}
}

// TestNamespaceQuotasBuilderMaintainedMatchesListPath is the end-to-end cutover
// proof: fed the same objects, a builder serving from the maintained store produces
// a byte-identical snapshot payload to the list-path builder, across window, query,
// filter, and search scopes.
func TestNamespaceQuotasBuilderMaintainedMatchesListPath(t *testing.T) {
	quotaDesc := quotasDescriptor(t, "resourcequotas")
	limitDesc := quotasDescriptor(t, "limitranges")
	pdbDesc := quotasDescriptor(t, "poddisruptionbudgets")

	quotas := []*corev1.ResourceQuota{
		quotaObj("default", "alpha", "1"),
		quotaObj("app", "beta", "2"),
	}
	limits := []*corev1.LimitRange{
		limitObj("default", "gamma", "3"),
	}
	pdbs := []*policyv1.PodDisruptionBudget{
		pdbObj("default", "epsilon", "5", 1),
		pdbObj("kube-system", "zeta", "6", 2),
	}

	quotaIdx := newNamespaceIndexer()
	limitIdx := newNamespaceIndexer()
	pdbIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, quotasQuerypageSchema(), quotaTableQueryAdapter())
	for _, q := range quotas {
		require.NoError(t, quotaIdx.Add(q))
		maintained.ingest(quotaDesc, q)
	}
	for _, l := range limits {
		require.NoError(t, limitIdx.Add(l))
		maintained.ingest(limitDesc, l)
	}
	for _, p := range pdbs {
		require.NoError(t, pdbIdx.Add(p))
		maintained.ingest(pdbDesc, p)
	}

	collect := quotasCollectIndexer(quotaIdx, limitIdx, pdbIdx)
	listBuilder := &NamespaceQuotasBuilder{collectIndexer: collect}
	maintainedBuilder := &NamespaceQuotasBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"namespace:default",
		"namespace:all",
		"cluster-a|namespace:all?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|namespace:all?limit=50&kinds=PodDisruptionBudget",
		"cluster-a|namespace:all?search=alpha",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceQuotasSnapshot),
			maintSnap.Payload.(NamespaceQuotasSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}
