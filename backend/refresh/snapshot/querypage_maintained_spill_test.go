package snapshot

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMaintainedStoreSpillRestoreRoundTrip proves a maintained store can be spilled to
// disk and restored into a fresh store with identical rows — the warm-paint capability
// the governor's Cold/re-warm uses. It goes through the store's adapter/schema, so it
// proves the typedMaintainedStore wiring (not just the raw querypage.Store) round-trips.
func TestMaintainedStoreSpillRestoreRoundTrip(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	pvDesc := clusterStorageDescriptor(t, "persistentvolumes")
	available := map[string]bool{"PersistentVolume": true}

	orig := newTypedMaintainedStore(meta, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
	orig.ingest(pvDesc, pvObj("pv-a", "10", "1Gi", "standard"))
	orig.ingest(pvDesc, pvObj("pv-b", "12", "2Gi", "fast"))
	orig.ingest(pvDesc, pvObj("pv-c", "8", "5Gi", "standard"))

	path := filepath.Join(t.TempDir(), "cluster-storage.spill")
	require.NoError(t, orig.SpillTo(path))

	restored := newTypedMaintainedStore(meta, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
	require.NoError(t, restored.RestoreFrom(path))

	require.ElementsMatch(t, orig.rows("", available), restored.rows("", available),
		"restored maintained store must hold the same rows as the spilled one")
}
