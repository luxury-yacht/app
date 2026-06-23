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
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
)

func pvObj(name, rv, capacity, storageClass string) *corev1.PersistentVolume {
	return &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Spec: corev1.PersistentVolumeSpec{
			StorageClassName: storageClass,
			Capacity:         corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(capacity)},
			AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
		},
		Status: corev1.PersistentVolumeStatus{Phase: corev1.VolumeAvailable},
	}
}

func findClusterStorageRow(rows []ClusterStorageEntry, kind, name string) *ClusterStorageEntry {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func clusterStorageDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(clusterStorageDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no cluster-storage descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

// TestClusterStorageMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary. The domain is cluster-scoped, so
// objects carry no namespace and the store is queried for all rows ("").
func TestClusterStorageMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	pvDesc := clusterStorageDescriptor(t, "persistentvolumes")
	store := newTypedMaintainedStore(meta, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
	available := map[string]bool{"PersistentVolume": true}

	store.ingest(pvDesc, pvObj("pv-a", "10", "1Gi", "standard"))
	store.ingest(pvDesc, pvObj("pv-b", "12", "2Gi", "fast"))
	store.ingest(pvDesc, pvObj("pv-c", "8", "5Gi", "standard"))

	require.Equal(t, uint64(12), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("", available), 3)

	want := persistentvolume.BuildStreamSummary(meta, pvObj("pv-a", "10", "1Gi", "standard"))
	got := findClusterStorageRow(store.rows("", available), "PersistentVolume", "pv-a")
	require.NotNil(t, got, "pv-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// Update pv-a in place: new resourceVersion + a different storage class, no duplicate.
	store.ingest(pvDesc, pvObj("pv-a", "20", "1Gi", "premium"))
	require.Equal(t, uint64(20), store.snapshotVersion())
	upd := findClusterStorageRow(store.rows("", available), "PersistentVolume", "pv-a")
	require.NotNil(t, upd)
	require.Equal(t, "premium", upd.StorageClass)
	require.Len(t, store.rows("", available), 3, "in-place update, no duplicate")

	// Delete pv-b directly; delete pv-c via a tombstone.
	store.evict(pvDesc, pvObj("pv-b", "21", "2Gi", "fast"))
	store.evict(pvDesc, cache.DeletedFinalStateUnknown{Key: "pv-c", Obj: pvObj("pv-c", "22", "5Gi", "standard")})
	require.Nil(t, findClusterStorageRow(store.rows("", available), "PersistentVolume", "pv-b"))
	require.Nil(t, findClusterStorageRow(store.rows("", available), "PersistentVolume", "pv-c"))
	require.Len(t, store.rows("", available), 1, "only pv-a remains")
}

// TestClusterStorageMaintainedStoreMatchesListPath is the SAFETY GATE for the live
// cutover: fed the same objects, the maintained store's rows must equal exactly what
// the current list path produces, for the cluster scope.
func TestClusterStorageMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	pvDesc := clusterStorageDescriptor(t, "persistentvolumes")

	pvs := []*corev1.PersistentVolume{
		pvObj("alpha", "1", "1Gi", "standard"),
		pvObj("beta", "2", "2Gi", "fast"),
		pvObj("gamma", "3", "5Gi", "standard"),
	}

	pvIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
	for _, pv := range pvs {
		require.NoError(t, pvIdx.Add(pv))
		store.ingest(pvDesc, pv)
	}

	collect := clusterStorageCollectIndexer(pvIdx)
	available := map[string]bool{"PersistentVolume": true}
	listed, _, _, err := collectDescriptorTableRows[ClusterStorageEntry](
		context.Background(), clusterStorageDomainName, collect, meta, "",
	)
	require.NoError(t, err)
	require.ElementsMatch(t, listed, store.rows("", available),
		"maintained store rows must equal the list path for the cluster scope")
}

// TestClusterStorageMaintainedStoreSinkMatchesListPath is the SAFETY GATE for the
// live ingest cutover: fed the projected StreamRow through the ingest Sink (the live
// reflector path PersistentVolume now takes via IngestOwned), the maintained store's
// rows must equal exactly what the list path produces.
func TestClusterStorageMaintainedStoreSinkMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	pvDesc := clusterStorageDescriptor(t, "persistentvolumes")

	pvs := []*corev1.PersistentVolume{
		pvObj("alpha", "1", "1Gi", "standard"),
		pvObj("beta", "2", "2Gi", "fast"),
		pvObj("gamma", "3", "5Gi", "standard"),
	}

	pvIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
	sink := store.Sink()
	for _, pv := range pvs {
		require.NoError(t, pvIdx.Add(pv))
		sink.Upsert(pvDesc.StreamRow(meta, pv))
	}

	collect := clusterStorageCollectIndexer(pvIdx)
	available := map[string]bool{"PersistentVolume": true}
	listed, _, _, err := collectDescriptorTableRows[ClusterStorageEntry](
		context.Background(), clusterStorageDomainName, collect, meta, "",
	)
	require.NoError(t, err)
	require.ElementsMatch(t, listed, store.rows("", available),
		"sink-fed maintained store rows must equal the list path for the cluster scope")

	sink.Delete(pvDesc.StreamRow(meta, pvs[0]))
	require.Nil(t, findClusterStorageRow(store.rows("", available), "PersistentVolume", "alpha"))
	require.Greater(t, store.snapshotVersion(), uint64(0), "sink mutations advance the snapshot version")
}

// TestClusterStorageBuilderMaintainedMatchesListPath is the end-to-end cutover proof:
// fed the same objects, a builder serving from the maintained store produces a
// byte-identical snapshot payload to the list-path builder, across window, query,
// sort, and search scopes.
func TestClusterStorageBuilderMaintainedMatchesListPath(t *testing.T) {
	pvDesc := clusterStorageDescriptor(t, "persistentvolumes")

	pvs := []*corev1.PersistentVolume{
		pvObj("alpha", "1", "1Gi", "standard"),
		pvObj("beta", "2", "2Gi", "fast"),
		pvObj("gamma", "3", "5Gi", "standard"),
	}

	pvIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
	for _, pv := range pvs {
		require.NoError(t, pvIdx.Add(pv))
		maintained.ingest(pvDesc, pv)
	}

	collect := clusterStorageCollectIndexer(pvIdx)
	listBuilder := &ClusterStorageBuilder{collectIndexer: collect}
	maintainedBuilder := &ClusterStorageBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"",
		"cluster-a|?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|?limit=50&sortField=capacity&sortDirection=desc",
		"cluster-a|?search=alpha",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(ClusterStorageSnapshot),
			maintSnap.Payload.(ClusterStorageSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}
