package snapshot

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// typedMaintainedStore must satisfy the SpillableStore interface (incl. SwapToMmap) so the
// registry can cool it to mmap. A compile-time assertion catches an interface drift fast.
var _ domain.SpillableStore = (*typedMaintainedStore[AutoscalingSummary])(nil)

// TestTypedMaintainedStoreSwapToMmapServesIdentically proves the Cold-tier serving
// transition at the maintained-store level: after SwapToMmap the SAME store keeps serving
// the SAME rows (now from the off-heap mmap-aliased columns), rejects writes (read-only),
// and bumps its refetch identity so a re-Build reflects the cooled state. The returned
// closer unmaps the file and is idempotent.
func TestTypedMaintainedStoreSwapToMmapServesIdentically(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")
	store := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	available := map[string]bool{"HorizontalPodAutoscaler": true}

	store.ingest(hpaDesc, hpaObj("default", "h-a", "10", "api", 4))
	store.ingest(hpaDesc, hpaObj("default", "h-b", "12", "web", 6))
	store.ingest(hpaDesc, hpaObj("kube-system", "h-c", "8", "ctrl", 2))

	before := store.rows("", available)
	require.Len(t, before, 3)
	versionBefore := store.snapshotVersion()

	path := filepath.Join(t.TempDir(), "autoscaling.qcm")
	closer, err := store.SwapToMmap(path)
	require.NoError(t, err)
	require.NotNil(t, closer)
	require.FileExists(t, path, "SwapToMmap writes the columnar mmap file")

	// (a) The cooled store serves the SAME rows as before cooling — now from the mapping.
	require.ElementsMatch(t, before, store.rows("", available),
		"cooled store must serve the same rows from its mmap-backed columns")

	// (b) The store is read-only: an Upsert through the sink is ignored.
	store.ingest(hpaDesc, hpaObj("default", "h-d", "99", "new", 9))
	require.Len(t, store.rows("", available), 3, "cooled (read-only) store rejects new rows")

	// (c) SwapToMmap bumped the refetch identity so a re-Build reflects the cooled set.
	require.Greater(t, store.snapshotVersion(), versionBefore,
		"SwapToMmap advances the snapshot version so refetch identity changes")

	// The closer unmaps; it is idempotent (a re-warm/teardown double-close must be a no-op).
	require.NoError(t, closer())
	require.NoError(t, closer(), "closer is idempotent")
}
