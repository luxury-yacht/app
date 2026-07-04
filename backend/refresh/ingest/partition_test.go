package ingest

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Namespace-scoped ingest (docs/plans/namespace-scope.md) runs one reflector
// per configured namespace against ONE shared store. Each reflector writes
// through a partition view, so client-go's "Replace = full state" contract
// holds per partition: a relist in one namespace must never wipe sibling
// namespaces' rows — the same bug class as the multi-kind unscoped
// BundleSink wipe, one level deeper.

func projectBundle(obj interface{}) (interface{}, error) {
	projected, err := projectConfigMap(obj)
	if err != nil {
		return nil, err
	}
	return Bundle{Table: projected, Catalog: projected}, nil
}

// partitionRecordingSink implements both the incremental and the bulk-replace
// sink contracts, so a test can prove which path a partition replace used.
type partitionRecordingSink struct {
	upserts  []Bundle
	deletes  []Bundle
	replaces [][]Bundle
}

func (s *partitionRecordingSink) UpsertBundle(b Bundle)        { s.upserts = append(s.upserts, b) }
func (s *partitionRecordingSink) DeleteBundle(b Bundle)        { s.deletes = append(s.deletes, b) }
func (s *partitionRecordingSink) ReplaceBundles(rows []Bundle) { s.replaces = append(s.replaces, rows) }

func TestReplacePartitionDoesNotWipeSiblingNamespaces(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	store.SetExpectedPartitions([]string{"prod", "dev"})
	prod := store.PartitionView("prod")
	dev := store.PartitionView("dev")

	require.NoError(t, prod.Replace([]interface{}{configMap("prod", "a")}, "10"))
	require.False(t, store.HasSynced(), "one of two partitions synced must not report store synced")
	require.NoError(t, dev.Replace([]interface{}{configMap("dev", "b")}, "12"))
	require.True(t, store.HasSynced())
	require.ElementsMatch(t, []string{"prod/a", "dev/b"}, store.ListKeys())

	// The wipe-class case: a relist in prod fully defines PROD ONLY.
	require.NoError(t, prod.Replace([]interface{}{configMap("prod", "c")}, "15"))
	require.ElementsMatch(t, []string{"prod/c", "dev/b"}, store.ListKeys(),
		"prod relist must drop prod/a but never touch dev rows")
}

func TestReplacePartitionEmitsPerRowSinkEventsNotBulkReplace(t *testing.T) {
	store := NewProjectingStore(projectBundle)
	store.SetExpectedPartitions([]string{"prod", "dev"})
	prod := store.PartitionView("prod")
	dev := store.PartitionView("dev")
	require.NoError(t, prod.Replace([]interface{}{configMap("prod", "a")}, "10"))
	require.NoError(t, dev.Replace([]interface{}{configMap("dev", "b")}, "11"))

	sink := &partitionRecordingSink{}
	store.AddBundleSink(sink)
	sink.upserts = nil
	sink.replaces = nil

	// prod relist: a vanishes, c appears. The bulk ReplaceBundles contract is
	// "full state for the kind" — a partition must never use it, or the sink
	// (maintained store) would drop dev's rows.
	require.NoError(t, prod.Replace([]interface{}{configMap("prod", "c")}, "15"))

	require.Empty(t, sink.replaces, "partition replace must not emit a bulk kind-wide Replace")
	require.Len(t, sink.deletes, 1)
	// Deletes fan the PREVIOUS stored bundle: its Table half was dropped at
	// store time (retainTable=false), its Catalog half is retained so
	// catalog-keyed consumers can evict the ghost.
	require.Equal(t, row{NS: "prod", Name: "a"}, sink.deletes[0].Catalog)
	require.Len(t, sink.upserts, 1)
	require.Equal(t, row{NS: "prod", Name: "c"}, sink.upserts[0].Table, "upserts fan the FULL projected value")
}

func TestPartitionViewMarkSyncedMarksOnlyItsPartition(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	store.SetExpectedPartitions([]string{"prod", "dev"})

	store.PartitionView("prod").MarkSynced()
	require.False(t, store.HasSynced())
	store.PartitionView("dev").MarkSynced()
	require.True(t, store.HasSynced())
}

func TestClusterWidePartitionViewKeepsBulkReplaceSemantics(t *testing.T) {
	// The unscoped path is the same code with a single "" partition: full
	// Replace semantics, including the bulk sink fan-out.
	store := NewProjectingStore(projectBundle)
	view := store.PartitionView("")
	require.NoError(t, view.Replace([]interface{}{configMap("prod", "a")}, "10"))

	sink := &partitionRecordingSink{}
	store.AddBundleSink(sink)
	sink.replaces = nil

	require.NoError(t, view.Replace([]interface{}{configMap("dev", "b")}, "12"))
	require.Len(t, sink.replaces, 1, "cluster-wide replace keeps the bulk sink path")
	require.True(t, store.HasSynced())
	require.ElementsMatch(t, []string{"dev/b"}, store.ListKeys(), "cluster-wide replace fully defines the store")
}

func TestPartitionResourceVersionsTrackPerPartition(t *testing.T) {
	store := NewProjectingStore(projectConfigMap)
	store.SetExpectedPartitions([]string{"prod", "dev"})
	require.NoError(t, store.PartitionView("prod").Replace([]interface{}{configMap("prod", "a")}, "10"))
	require.NoError(t, store.PartitionView("dev").Replace([]interface{}{configMap("dev", "b")}, "12"))

	rvs := store.PartitionResourceVersions()
	require.Equal(t, map[string]string{"prod": "10", "dev": "12"}, rvs)
}
