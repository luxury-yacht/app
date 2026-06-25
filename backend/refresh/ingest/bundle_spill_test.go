package ingest

import (
	"encoding/gob"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// spillTestRow is a representative projected Table-half row. It is gob-registered so the
// type-erased Bundle (whose halves are interface{}) can be gob-encoded — mirroring the
// central registration the production spill relies on.
type spillTestRow struct {
	Name string
	N    int
}

func init() { gob.Register(spillTestRow{}) }

// bundleProjectingStore returns a store whose projection wraps each object's name in a
// Bundle's Table half — the shape the ingest stores hold.
func bundleProjectingStore() *ProjectingStore {
	return NewProjectingStore(func(obj interface{}) (interface{}, error) {
		m := obj.(metav1.Object)
		return Bundle{Table: spillTestRow{Name: m.GetName(), N: len(m.GetName())}}, nil
	})
}

// TestSpillRestoreBundlesRoundTrip proves the ingest-store serialization primitive: spilling
// the projected Bundles + the observed resourceVersion and restoring them into a fresh store
// reproduces the rows and RV, and marks the store synced (the precondition for resuming the
// watch from that RV without a full re-LIST).
func TestSpillRestoreBundlesRoundTrip(t *testing.T) {
	orig := bundleProjectingStore()
	require.NoError(t, orig.Replace([]interface{}{
		resumeCM("a", "10"),
		resumeCM("b", "11"),
		resumeCM("c", "12"),
	}, "12"))
	require.Equal(t, 3, len(orig.List()))
	require.Equal(t, "12", orig.LastStoreSyncResourceVersion())

	path := filepath.Join(t.TempDir(), "configmaps.bundles")
	require.NoError(t, orig.SpillBundles(path))

	restored := bundleProjectingStore()
	rv, err := restored.RestoreBundles(path)
	require.NoError(t, err)
	require.Equal(t, "12", rv, "RestoreBundles returns the persisted RV for the resume")
	require.Equal(t, "12", restored.LastStoreSyncResourceVersion())
	require.True(t, restored.HasSynced(), "a restored store is serveable (synced) for resume")

	// The Table halves survived intact.
	got := map[string]int{}
	for _, row := range restored.TableRows() {
		r := row.(spillTestRow)
		got[r.Name] = r.N
	}
	require.Equal(t, map[string]int{"a": 1, "b": 1, "c": 1}, got)
}

// TestRestoreBundlesMissingFileErrors proves restore fails cleanly (no panic) on a missing
// file — the caller treats the error as "skip → full sync".
func TestRestoreBundlesMissingFileErrors(t *testing.T) {
	store := bundleProjectingStore()
	_, err := store.RestoreBundles(filepath.Join(t.TempDir(), "does-not-exist.bundles"))
	require.Error(t, err)
	require.False(t, store.HasSynced(), "a failed restore leaves the store unsynced (it will full-sync)")
}

func cmGVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}
}

// TestSpillRestoreStoresSetsResumeRV is the manager-level activation: SpillStores persists each
// entry's store, and RestoreStores on a fresh manager repopulates the store AND sets the
// entry's resumeRV from the persisted RV — so Start's runWithResume resumes the watch from it
// instead of a full re-LIST. registerGobTypes (called inside both) registers the projected
// types via each entry's example object.
func TestSpillRestoreStoresSetsResumeRV(t *testing.T) {
	storeA := bundleProjectingStore()
	require.NoError(t, storeA.Replace([]interface{}{resumeCM("a", "10"), resumeCM("b", "11")}, "11"))
	src := &IngestManager{entries: map[schema.GroupVersionResource]*entry{
		cmGVR(): {store: storeA, example: resumeCM("ex", "0")},
	}}

	dir := t.TempDir()
	require.NoError(t, src.SpillStores(dir))

	storeB := bundleProjectingStore()
	dstEntry := &entry{store: storeB, example: resumeCM("ex", "0")}
	dst := &IngestManager{entries: map[schema.GroupVersionResource]*entry{cmGVR(): dstEntry}}
	dst.RestoreStores(dir)

	require.Equal(t, "11", dstEntry.resumeRV, "restore sets resumeRV from the persisted store RV")
	require.Equal(t, 2, len(storeB.List()), "restore repopulates the store full")
	require.True(t, storeB.HasSynced())
}

// TestRestoreStoresNoFileLeavesResumeUnset proves the safe default: a gvr with no spill file
// keeps resumeRV empty, so its reflector full-syncs (no regression, no incomplete store).
func TestRestoreStoresNoFileLeavesResumeUnset(t *testing.T) {
	store := bundleProjectingStore()
	e := &entry{store: store, example: resumeCM("ex", "0")}
	dst := &IngestManager{entries: map[schema.GroupVersionResource]*entry{cmGVR(): e}}

	dst.RestoreStores(t.TempDir()) // empty dir — no spill file

	require.Equal(t, "", e.resumeRV, "no spill file → resumeRV stays empty → full sync")
	require.False(t, store.HasSynced())
}
