package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
)

func pvcObj(ns, name, rv, capacity, storageClass string) *corev1.PersistentVolumeClaim {
	sc := storageClass
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Spec: corev1.PersistentVolumeClaimSpec{
			StorageClassName: &sc,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(capacity)},
			},
		},
		Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
	}
}

func findStorageRow(rows []StorageSummary, kind, ns, name string) *StorageSummary {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Namespace == ns && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func storageDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceStorageDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no namespace-storage descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

// TestStorageMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary.
func TestStorageMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	pvcDesc := storageDescriptor(t, "persistentvolumeclaims")
	store := newTypedMaintainedStore(meta, storageQuerypageSchema(), storageTableQueryAdapter())
	available := map[string]bool{"PersistentVolumeClaim": true}

	store.ingest(pvcDesc, pvcObj("default", "pvc-a", "10", "1Gi", "standard"))
	store.ingest(pvcDesc, pvcObj("default", "pvc-b", "12", "2Gi", "fast"))
	store.ingest(pvcDesc, pvcObj("kube-system", "pvc-c", "8", "5Gi", "standard"))

	require.Equal(t, uint64(12), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("default", available), 2)
	require.Len(t, store.rows("", available), 3)
	require.Len(t, store.rows("kube-system", available), 1)

	want := persistentvolumeclaim.BuildStreamSummary(meta, pvcObj("default", "pvc-a", "10", "1Gi", "standard"))
	got := findStorageRow(store.rows("default", available), "PersistentVolumeClaim", "default", "pvc-a")
	require.NotNil(t, got, "pvc-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// Update pvc-a in place: new resourceVersion + a different storage class, no duplicate.
	store.ingest(pvcDesc, pvcObj("default", "pvc-a", "20", "1Gi", "premium"))
	require.Equal(t, uint64(20), store.snapshotVersion())
	upd := findStorageRow(store.rows("default", available), "PersistentVolumeClaim", "default", "pvc-a")
	require.NotNil(t, upd)
	require.Equal(t, "premium", upd.StorageClass)
	require.Len(t, store.rows("default", available), 2, "in-place update, no duplicate")

	// Delete pvc-b directly; delete pvc-c via a tombstone.
	store.evict(pvcDesc, pvcObj("default", "pvc-b", "21", "2Gi", "fast"))
	store.evict(pvcDesc, cache.DeletedFinalStateUnknown{Key: "kube-system/pvc-c", Obj: pvcObj("kube-system", "pvc-c", "22", "5Gi", "standard")})
	require.Nil(t, findStorageRow(store.rows("default", available), "PersistentVolumeClaim", "default", "pvc-b"))
	require.Nil(t, findStorageRow(store.rows("kube-system", available), "PersistentVolumeClaim", "kube-system", "pvc-c"))
	require.Len(t, store.rows("default", available), 1, "only pvc-a remains in default")
}

// TestStorageMaintainedStoreSinkMatchesListPath is the SAFETY GATE for the live
// ingest cutover: fed the projected StreamRow through the ingest Sink (the live
// reflector path PersistentVolumeClaim now takes via IngestOwned), the maintained
// store's rows must equal exactly what the list path produces, for every namespace
// scope. The sink delivers the bundle's Table half directly.
func TestStorageMaintainedStoreSinkMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	pvcDesc := storageDescriptor(t, "persistentvolumeclaims")

	pvcs := []*corev1.PersistentVolumeClaim{
		pvcObj("default", "alpha", "1", "1Gi", "standard"),
		pvcObj("default", "beta", "2", "2Gi", "fast"),
		pvcObj("kube-system", "gamma", "3", "5Gi", "standard"),
		pvcObj("app", "delta", "4", "10Gi", "premium"),
	}

	pvcIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, storageQuerypageSchema(), storageTableQueryAdapter())
	sink := store.Sink()
	for _, pvc := range pvcs {
		require.NoError(t, pvcIdx.Add(pvc))
		sink.Upsert(pvcDesc.StreamRow(meta, pvc))
	}

	collect := storageCollectIndexer(pvcIdx)
	available := map[string]bool{"PersistentVolumeClaim": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[StorageSummary](
			context.Background(), namespaceStorageDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"sink-fed maintained store rows must equal the list path for namespace %q", ns)
	}

	// A delete through the sink evicts the row, exactly like a watch delete.
	sink.Delete(pvcDesc.StreamRow(meta, pvcs[0]))
	require.Nil(t, findStorageRow(store.rows("default", available), "PersistentVolumeClaim", "default", "alpha"))
	require.Greater(t, store.snapshotVersion(), uint64(0), "sink mutations advance the snapshot version")
}

// TestStorageMaintainedStoreMatchesListPath is the SAFETY GATE for the live cutover:
// fed the same objects, the maintained store's rows must equal exactly what the
// current list path (collectDescriptorTableRows over a fake indexer) produces, for
// every namespace scope.
func TestStorageMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	pvcDesc := storageDescriptor(t, "persistentvolumeclaims")

	pvcs := []*corev1.PersistentVolumeClaim{
		pvcObj("default", "alpha", "1", "1Gi", "standard"),
		pvcObj("default", "beta", "2", "2Gi", "fast"),
		pvcObj("kube-system", "gamma", "3", "5Gi", "standard"),
		pvcObj("app", "delta", "4", "10Gi", "premium"),
	}

	pvcIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, storageQuerypageSchema(), storageTableQueryAdapter())
	for _, pvc := range pvcs {
		require.NoError(t, pvcIdx.Add(pvc))
		store.ingest(pvcDesc, pvc)
	}

	collect := storageCollectIndexer(pvcIdx)
	available := map[string]bool{"PersistentVolumeClaim": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[StorageSummary](
			context.Background(), namespaceStorageDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"maintained store rows must equal the list path for namespace %q", ns)
	}
}

// TestNamespaceStorageBuilderMaintainedMatchesListPath is the end-to-end cutover
// proof: fed the same objects, a builder serving from the maintained store produces
// a byte-identical snapshot payload to the list-path builder, across window, query,
// filter, and search scopes.
func TestNamespaceStorageBuilderMaintainedMatchesListPath(t *testing.T) {
	pvcDesc := storageDescriptor(t, "persistentvolumeclaims")

	pvcs := []*corev1.PersistentVolumeClaim{
		pvcObj("default", "alpha", "1", "1Gi", "standard"),
		pvcObj("default", "beta", "2", "2Gi", "fast"),
		pvcObj("kube-system", "gamma", "3", "5Gi", "standard"),
	}

	pvcIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, storageQuerypageSchema(), storageTableQueryAdapter())
	for _, pvc := range pvcs {
		require.NoError(t, pvcIdx.Add(pvc))
		maintained.ingest(pvcDesc, pvc)
	}

	collect := storageCollectIndexer(pvcIdx)
	listBuilder := &NamespaceStorageBuilder{collectIndexer: collect}
	maintainedBuilder := &NamespaceStorageBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"namespace:default",
		"namespace:all",
		"cluster-a|namespace:default?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|namespace:all?limit=50&sortField=capacity&sortDirection=desc",
		"cluster-a|namespace:all?search=alpha",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceStorageSnapshot),
			maintSnap.Payload.(NamespaceStorageSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}
