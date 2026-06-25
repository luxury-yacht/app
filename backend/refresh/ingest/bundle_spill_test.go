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

// spillTestCatalog is a representative projected Catalog-half row, gob-registered like the
// Table half so a spilled Bundle carrying it round-trips.
type spillTestCatalog struct {
	Key string
}

func init() {
	gob.Register(spillTestRow{})
	gob.Register(spillTestCatalog{})
}

// bundleProjectingStore returns a store whose projection wraps each object's name in a
// Bundle's Table AND Catalog halves — the shape the production ingest stores hold (every
// ingest-owned kind registers a catalog projector). retainTable mirrors the production
// per-store flag: false (the default) drops the redundant Table half from the stored bundle
// after fanning it; pods set it true.
func bundleProjectingStore(retainTable bool) *ProjectingStore {
	s := NewProjectingStore(func(obj interface{}) (interface{}, error) {
		m := obj.(metav1.Object)
		return Bundle{
			Table:   spillTestRow{Name: m.GetName(), N: len(m.GetName())},
			Catalog: spillTestCatalog{Key: m.GetName()},
		}, nil
	})
	s.SetRetainTable(retainTable)
	return s
}

// TestSpillRestoreBundlesRoundTrip proves the ingest-store serialization primitive: spilling
// the projected Bundles + the observed resourceVersion and restoring them into a fresh store
// reproduces the rows and RV, and marks the store synced (the precondition for resuming the
// watch from that RV without a full re-LIST). The default store drops the redundant Table
// half (the maintained store holds it columnar), so the spilled bundle carries a nil Table
// half and the RETAINED Catalog half — and both spill/restore cleanly. On re-warm the
// reflector re-projects and re-emits the Table half to the maintained store, so a nil stored
// Table is correct, not a regression.
func TestSpillRestoreBundlesRoundTrip(t *testing.T) {
	orig := bundleProjectingStore(false)
	require.NoError(t, orig.Replace([]interface{}{
		resumeCM("a", "10"),
		resumeCM("b", "11"),
		resumeCM("c", "12"),
	}, "12"))
	require.Equal(t, 3, len(orig.List()))
	require.Equal(t, "12", orig.LastStoreSyncResourceVersion())

	path := filepath.Join(t.TempDir(), "configmaps.bundles")
	require.NoError(t, orig.SpillBundles(path))

	restored := bundleProjectingStore(false)
	rv, err := restored.RestoreBundles(path)
	require.NoError(t, err)
	require.Equal(t, "12", rv, "RestoreBundles returns the persisted RV for the resume")
	require.Equal(t, "12", restored.LastStoreSyncResourceVersion())
	require.True(t, restored.HasSynced(), "a restored store is serveable (synced) for resume")

	// The Table half was dropped from the stored (and thus spilled) bundle.
	require.Empty(t, restored.TableRows(), "the dropped Table half stays absent across spill/restore")
	// The retained Catalog half survived intact.
	gotCatalog := map[string]bool{}
	for _, row := range restored.CatalogRows() {
		gotCatalog[row.(spillTestCatalog).Key] = true
	}
	require.Equal(t, map[string]bool{"a": true, "b": true, "c": true}, gotCatalog)
}

// TestSpillRestoreBundlesRetainsTableHalf proves a retainTable=TRUE store (the pod store)
// keeps the Table half across spill/restore, so the pod standalone-synthesis + notify paths
// still read it after a re-warm.
func TestSpillRestoreBundlesRetainsTableHalf(t *testing.T) {
	orig := bundleProjectingStore(true)
	require.NoError(t, orig.Replace([]interface{}{resumeCM("a", "10"), resumeCM("b", "11")}, "11"))

	path := filepath.Join(t.TempDir(), "pods.bundles")
	require.NoError(t, orig.SpillBundles(path))

	restored := bundleProjectingStore(true)
	_, err := restored.RestoreBundles(path)
	require.NoError(t, err)

	got := map[string]int{}
	for _, row := range restored.TableRows() {
		r := row.(spillTestRow)
		got[r.Name] = r.N
	}
	require.Equal(t, map[string]int{"a": 1, "b": 1}, got, "retained Table halves survive spill/restore")
}

// TestRestoreBundlesMissingFileErrors proves restore fails cleanly (no panic) on a missing
// file — the caller treats the error as "skip → full sync".
func TestRestoreBundlesMissingFileErrors(t *testing.T) {
	store := bundleProjectingStore(false)
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
	storeA := bundleProjectingStore(false)
	require.NoError(t, storeA.Replace([]interface{}{resumeCM("a", "10"), resumeCM("b", "11")}, "11"))
	src := &IngestManager{entries: map[schema.GroupVersionResource]*entry{
		cmGVR(): {store: storeA, example: resumeCM("ex", "0")},
	}}

	dir := t.TempDir()
	require.NoError(t, src.SpillStores(dir))

	storeB := bundleProjectingStore(false)
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
	store := bundleProjectingStore(false)
	e := &entry{store: store, example: resumeCM("ex", "0")}
	dst := &IngestManager{entries: map[schema.GroupVersionResource]*entry{cmGVR(): e}}

	dst.RestoreStores(t.TempDir()) // empty dir — no spill file

	require.Equal(t, "", e.resumeRV, "no spill file → resumeRV stays empty → full sync")
	require.False(t, store.HasSynced())
}
