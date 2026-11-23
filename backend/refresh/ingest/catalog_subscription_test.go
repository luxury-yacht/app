package ingest

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCatalogSubscriptionDetachesWithoutStoppingSource(t *testing.T) {
	store := NewProjectingStore(bundleProject(false, false))
	require.NoError(t, store.Add(cm("default", "before")))
	retired := &recordingSink{}
	detach := store.SubscribeCatalogSink(retired)
	replacement := &recordingSink{}
	defer store.SubscribeCatalogSink(replacement)()
	before, _ := retired.snapshot()
	require.Len(t, before, 1, "a new catalog must receive the current baseline")
	detach()
	detach()
	require.NoError(t, store.Replace([]interface{}{cm("default", "after")}, "2"))
	upserts, deletes := retired.snapshot()
	require.Len(t, upserts, 1, "a retired catalog must not receive later source rows")
	require.Empty(t, deletes, "a retired catalog must not receive later deletions")
	currentUpserts, currentDeletes := replacement.snapshot()
	require.Len(t, currentUpserts, 2)
	require.Len(t, currentDeletes, 1, "detachment must preserve other consumers' relist deletions")
	require.Len(t, store.CatalogRows(), 1, "detaching a consumer must leave the source alive")
}

func TestBundleSubscriptionPublishesOnlySyncedReplayAsComplete(t *testing.T) {
	store := NewProjectingStore(bundleProject(false, false))
	require.NoError(t, store.Add(cm("default", "before-list")))
	early := &partitionRecordingSink{}
	defer store.SubscribeBundleSink(early)()
	require.Empty(t, early.replaces, "an unsynced replay cannot establish that missing objects are absent")
	require.Equal(t, catalogRow{Key: "default/before-list"}, requireSingleBundle(t, early.upserts).Catalog)

	require.NoError(t, store.Replace([]interface{}{cm("default", "listed")}, "2"))
	require.Len(t, early.replaces, 1)
	require.Equal(t, catalogRow{Key: "default/listed"}, requireSingleBundle(t, early.replaces[0]).Catalog)

	late := &partitionRecordingSink{}
	detach := store.SubscribeBundleSink(late)
	require.Empty(t, late.upserts)
	require.Len(t, late.replaces, 1)
	require.Equal(t, catalogRow{Key: "default/listed"}, requireSingleBundle(t, late.replaces[0]).Catalog)
	require.NoError(t, store.Add(cm("default", "added")))
	require.Equal(t, catalogRow{Key: "default/added"}, requireSingleBundle(t, late.upserts).Catalog)
	detach()
	require.NoError(t, store.Replace(nil, "3"))
	require.Len(t, late.replaces, 1, "the retired consumer gets no updates")
	require.Len(t, early.replaces, 2)
	require.Empty(t, early.replaces[1], "a completed empty list is authoritative")
}

func requireSingleBundle(t *testing.T, bundles []Bundle) Bundle {
	t.Helper()
	require.Len(t, bundles, 1)
	return bundles[0]
}
