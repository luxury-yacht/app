package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/configmap"
)

func cmObj(ns, name, rv string, data map[string]string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Data:       data,
	}
}

func secObj(ns, name, rv string, data map[string][]byte) *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Data:       data,
		Type:       corev1.SecretTypeOpaque,
	}
}

func findConfigRow(rows []ConfigSummary, kind, ns, name string) *ConfigSummary {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Namespace == ns && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func configDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceConfigDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no namespace-config descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

func newNamespaceIndexer() cache.Indexer {
	return cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		cache.NamespaceIndex: cache.MetaNamespaceIndexFunc,
	})
}

// TestConfigMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary.
func TestConfigMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	cmDesc := configDescriptor(t, "configmaps")
	secDesc := configDescriptor(t, "secrets")
	store := newTypedMaintainedStore(meta, configQuerypageSchema(), configTableQueryAdapter())
	available := map[string]bool{"ConfigMap": true, "Secret": true}

	store.ingest(cmDesc, cmObj("default", "cm-a", "10", map[string]string{"k": "v"}))
	store.ingest(cmDesc, cmObj("default", "cm-b", "12", map[string]string{"k1": "v1", "k2": "v2"}))
	store.ingest(cmDesc, cmObj("kube-system", "cm-c", "8", nil))
	store.ingest(secDesc, secObj("default", "sec-a", "15", map[string][]byte{"t": []byte("x")}))

	require.Equal(t, uint64(15), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("default", available), 3)
	require.Len(t, store.rows("", available), 4)
	require.Len(t, store.rows("kube-system", available), 1)

	want := configmap.BuildStreamSummary(meta, cmObj("default", "cm-a", "10", map[string]string{"k": "v"}))
	got := findConfigRow(store.rows("default", available), "ConfigMap", "default", "cm-a")
	require.NotNil(t, got, "cm-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// Update cm-a in place: new resourceVersion + an extra data key, no duplicate.
	store.ingest(cmDesc, cmObj("default", "cm-a", "20", map[string]string{"k": "v", "k2": "v2"}))
	require.Equal(t, uint64(20), store.snapshotVersion())
	upd := findConfigRow(store.rows("default", available), "ConfigMap", "default", "cm-a")
	require.NotNil(t, upd)
	require.Equal(t, 2, upd.Data)
	require.Len(t, store.rows("default", available), 3, "in-place update, no duplicate")

	// Delete cm-b directly; delete sec-a via a tombstone.
	store.evict(cmDesc, cmObj("default", "cm-b", "21", nil))
	store.evict(secDesc, cache.DeletedFinalStateUnknown{Key: "default/sec-a", Obj: secObj("default", "sec-a", "22", nil)})
	require.Nil(t, findConfigRow(store.rows("default", available), "ConfigMap", "default", "cm-b"))
	require.Nil(t, findConfigRow(store.rows("default", available), "Secret", "default", "sec-a"))
	require.Len(t, store.rows("default", available), 1, "only cm-a remains")
}

// TestConfigMaintainedStoreMatchesListPath is the SAFETY GATE for the live cutover:
// fed the same objects, the maintained store's rows must equal exactly
// what the current list path (collectDescriptorTableRows over a fake indexer)
// produces, for every namespace scope.
func TestConfigMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	cmDesc := configDescriptor(t, "configmaps")
	secDesc := configDescriptor(t, "secrets")

	cms := []*corev1.ConfigMap{
		cmObj("default", "alpha", "1", map[string]string{"a": "1"}),
		cmObj("default", "beta", "2", map[string]string{"a": "1", "b": "2"}),
		cmObj("kube-system", "gamma", "3", nil),
		cmObj("app", "delta", "4", map[string]string{"x": "y"}),
	}
	secs := []*corev1.Secret{
		secObj("default", "s-one", "5", map[string][]byte{"t": []byte("x")}),
		secObj("kube-system", "s-two", "6", nil),
	}

	cmIdx := newNamespaceIndexer()
	secIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, configQuerypageSchema(), configTableQueryAdapter())
	for _, cm := range cms {
		require.NoError(t, cmIdx.Add(cm))
		store.ingest(cmDesc, cm)
	}
	for _, s := range secs {
		require.NoError(t, secIdx.Add(s))
		store.ingest(secDesc, s)
	}

	collect := configCollectIndexer(cmIdx, secIdx)
	available := map[string]bool{"ConfigMap": true, "Secret": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[ConfigSummary](
			context.Background(), namespaceConfigDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"maintained store rows must equal the list path for namespace %q", ns)
	}
}

func TestConfigMaintainedStoreBulkReplaceScopesSourceKind(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	cmDesc := configDescriptor(t, "configmaps")
	secDesc := configDescriptor(t, "secrets")
	store := newTypedMaintainedStore(meta, configQuerypageSchema(), configTableQueryAdapter())
	available := map[string]bool{"ConfigMap": true, "Secret": true}

	sec := secObj("default", "sec-a", "5", map[string][]byte{"t": []byte("x")})
	secRow, ok := secDesc.StreamRow(meta, sec).(ConfigSummary)
	require.True(t, ok)
	store.Sink().Upsert(secRow)

	cmSink, ok := store.bundleSinkFor(cmDesc).(ingest.BundleReplaceSink)
	require.True(t, ok, "source-scoped maintained sink must support bulk bundle replace")
	projectCatalog := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, configmap.Identity)
	cmSink.ReplaceBundles([]ingest.Bundle{{
		Table:   cmDesc.StreamRow(meta, cmObj("default", "cm-a", "10", map[string]string{"k": "v"})),
		Catalog: projectCatalog(cmObj("default", "cm-a", "10", map[string]string{"k": "v"})),
	}})

	rows := store.rows("default", available)
	require.NotNil(t, findConfigRow(rows, "ConfigMap", "default", "cm-a"))
	require.NotNil(t, findConfigRow(rows, "Secret", "default", "sec-a"))

	cmSink.ReplaceBundles(nil)
	rows = store.rows("default", available)
	require.Nil(t, findConfigRow(rows, "ConfigMap", "default", "cm-a"))
	require.NotNil(t, findConfigRow(rows, "Secret", "default", "sec-a"))
}

// TestNamespaceConfigBuilderMaintainedMatchesListPath is the end-to-end cutover
// proof: fed the same objects, a builder serving from the maintained store produces
// a byte-identical snapshot payload to the list-path builder, across window, query,
// filter, and search scopes. (Uses zero ClusterMeta so both project identically; the
// Snapshot.Version differs by design — both are valid refetch triggers.)
func TestNamespaceConfigBuilderMaintainedMatchesListPath(t *testing.T) {
	cmDesc := configDescriptor(t, "configmaps")
	secDesc := configDescriptor(t, "secrets")

	cms := []*corev1.ConfigMap{
		cmObj("default", "alpha", "1", map[string]string{"a": "1"}),
		cmObj("default", "beta", "2", map[string]string{"a": "1", "b": "2"}),
		cmObj("kube-system", "gamma", "3", nil),
	}
	secs := []*corev1.Secret{
		secObj("default", "s-one", "5", map[string][]byte{"t": []byte("x")}),
		secObj("kube-system", "s-two", "6", nil),
	}

	cmIdx := newNamespaceIndexer()
	secIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, configQuerypageSchema(), configTableQueryAdapter())
	for _, cm := range cms {
		require.NoError(t, cmIdx.Add(cm))
		maintained.ingest(cmDesc, cm)
	}
	for _, s := range secs {
		require.NoError(t, secIdx.Add(s))
		maintained.ingest(secDesc, s)
	}

	collect := configCollectIndexer(cmIdx, secIdx)
	listBuilder := &NamespaceConfigBuilder{collectIndexer: collect}
	maintainedBuilder := &NamespaceConfigBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"namespace:default",
		"namespace:all",
		"cluster-a|namespace:default?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|namespace:default?limit=50&kinds=Secret",
		"cluster-a|namespace:all?search=alpha",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceConfigSnapshot),
			maintSnap.Payload.(NamespaceConfigSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}

// TestNamespaceConfigDirectServeEdgeScopesMatchListPath hardens the direct-serve path
// against edge scopes the byte-identity contract must still honor: a search with
// surrounding whitespace (the live matcher trims; the direct page query must too), a
// descending sort, a mixed-case kind filter, and multi-page cursor round-trips. It is
// kept separate from the cutover gate above so that test stays unchanged.
func TestNamespaceConfigDirectServeEdgeScopesMatchListPath(t *testing.T) {
	cmDesc := configDescriptor(t, "configmaps")
	secDesc := configDescriptor(t, "secrets")

	cms := []*corev1.ConfigMap{
		cmObj("default", "alpha", "1", map[string]string{"a": "1"}),
		cmObj("default", "beta", "2", map[string]string{"a": "1", "b": "2"}),
		cmObj("default", "alphabet", "3", nil),
		cmObj("kube-system", "gamma", "4", nil),
		cmObj("app", "alpine", "5", nil),
	}
	secs := []*corev1.Secret{
		secObj("default", "alpha-secret", "6", map[string][]byte{"t": []byte("x")}),
		secObj("kube-system", "s-two", "7", nil),
		secObj("app", "alpha-token", "8", nil),
	}

	cmIdx := newNamespaceIndexer()
	secIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, configQuerypageSchema(), configTableQueryAdapter())
	for _, cm := range cms {
		require.NoError(t, cmIdx.Add(cm))
		maintained.ingest(cmDesc, cm)
	}
	for _, s := range secs {
		require.NoError(t, secIdx.Add(s))
		maintained.ingest(secDesc, s)
	}

	collect := configCollectIndexer(cmIdx, secIdx)
	listBuilder := &NamespaceConfigBuilder{collectIndexer: collect}
	maintainedBuilder := &NamespaceConfigBuilder{collectIndexer: collect, maintained: maintained}

	// Single-shot scopes: whitespace-padded search, descending sort, mixed-case kind
	// filter, and a kind+search combination.
	for _, scope := range []string{
		"cluster-a|namespace:all?search=%20alpha%20",                // padded search must trim
		"cluster-a|namespace:all?sortField=name&sortDirection=desc", // descending
		"cluster-a|namespace:all?kinds=configmap",                   // lower-cased kind filter
		"cluster-a|namespace:all?kinds=ConfigMap&search=alpha",      // kind + search
		"cluster-a|namespace:default?kinds=Secret&kinds=ConfigMap",  // multi-kind
	} {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)
		require.Equal(t,
			listSnap.Payload.(NamespaceConfigSnapshot),
			maintSnap.Payload.(NamespaceConfigSnapshot),
			"scope %q: direct serve must equal list path", scope)
	}

	// Multi-page cursor round-trip: page through the full ascending set limit=2 and
	// require each page's payload (rows, facets, totals, continue token) to match.
	scope := "cluster-a|namespace:all?limit=2&sortField=name&sortDirection=asc"
	for guard := 0; guard < 50; guard++ {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		listPayload := listSnap.Payload.(NamespaceConfigSnapshot)
		maintPayload := maintSnap.Payload.(NamespaceConfigSnapshot)
		require.Equal(t, listPayload, maintPayload, "paged scope %q must match", scope)

		next := listPayload.ResourceQueryEnvelope.Continue
		if next == "" {
			return
		}
		scope = "cluster-a|namespace:all?limit=2&sortField=name&sortDirection=asc&continue=" + next
	}
	t.Fatal("pagination did not terminate")
}
