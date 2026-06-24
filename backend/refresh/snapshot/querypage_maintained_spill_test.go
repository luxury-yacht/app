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

// TestMaintainedStoreReconcileDropsGhosts is the correctness core of the re-warm path: a
// store pre-painted from a (stale) spill holds a row for an object that was deleted while
// the cluster was Cold. A shared-informer-fed kind gets only Add/Update/Delete on a fresh
// informer, so the deletion is never delivered — reconcile() against the live informer
// list must drop that ghost while keeping rows that still exist.
func TestMaintainedStoreReconcileDropsGhosts(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	cmDesc := configDescriptor(t, "configmaps")
	available := map[string]bool{"ConfigMap": true, "Secret": true}

	store := newTypedMaintainedStore(meta, configQuerypageSchema(), configTableQueryAdapter())
	// Simulate a restored (stale) store: cm-a still exists upstream, cm-ghost was deleted
	// while the cluster was Cold.
	store.ingest(cmDesc, cmObj("default", "cm-a", "10", map[string]string{"k": "v"}))
	store.ingest(cmDesc, cmObj("default", "cm-ghost", "11", map[string]string{"k": "v"}))
	require.Len(t, store.rows("", available), 2)

	// The fresh informer's live set contains only cm-a.
	store.addReconcileSource(cmDesc, func() []interface{} {
		return []interface{}{cmObj("default", "cm-a", "20", map[string]string{"k": "v2"})}
	})
	store.Reconcile()

	rows := store.rows("", available)
	require.Len(t, rows, 1, "the ghost configmap must be reconciled away")
	require.NotNil(t, findConfigRow(rows, "ConfigMap", "default", "cm-a"), "cm-a still exists upstream → kept")
	require.Nil(t, findConfigRow(rows, "ConfigMap", "default", "cm-ghost"), "cm-ghost deleted while Cold → dropped")
}

// TestMaintainedStoreReconcileScopedByKind pins the per-kind scoping: reconcile only
// removes ghosts of the KIND it has a reconcile source for. A different kind in the same
// store (an ingest-fed kind, which self-reconciles via its reflector's Replace and has NO
// reconcile source here) must be left untouched, or reconcile would wrongly delete live
// rows it has no live-set for.
func TestMaintainedStoreReconcileScopedByKind(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	cmDesc := configDescriptor(t, "configmaps")
	available := map[string]bool{"ConfigMap": true, "Secret": true}

	store := newTypedMaintainedStore(meta, configQuerypageSchema(), configTableQueryAdapter())
	store.ingest(cmDesc, cmObj("default", "cm-ghost", "10", map[string]string{"k": "v"}))
	secDesc := configDescriptor(t, "secrets")
	store.ingest(secDesc, secObj("default", "sec-keep", "11", map[string][]byte{"k": []byte("v")}))

	// Only ConfigMap has a reconcile source (Secret is "ingest-fed" in this scenario, so it
	// has none). The live ConfigMap set is empty → cm-ghost is a ghost.
	store.addReconcileSource(cmDesc, func() []interface{} { return nil })
	store.Reconcile()

	rows := store.rows("", available)
	require.Nil(t, findConfigRow(rows, "ConfigMap", "default", "cm-ghost"), "the configmap ghost is reconciled away")
	require.NotNil(t, findConfigRow(rows, "Secret", "default", "sec-keep"),
		"a kind with no reconcile source (ingest-fed) must NOT be touched by reconcile")
}
