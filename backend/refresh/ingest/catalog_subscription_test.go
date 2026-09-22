package ingest

import (
	"github.com/stretchr/testify/require"
	"testing"
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
