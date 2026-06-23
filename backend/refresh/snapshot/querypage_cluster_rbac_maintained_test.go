package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
)

func clusterRoleObj(name, rv string) *rbacv1.ClusterRole {
	return &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Rules:      []rbacv1.PolicyRule{{APIGroups: []string{"*"}, Resources: []string{"*"}, Verbs: []string{"*"}}},
	}
}

func clusterRoleBindingObj(name, rv string) *rbacv1.ClusterRoleBinding {
	return &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "edit"},
		Subjects:   []rbacv1.Subject{{Kind: "Group", Name: "developers"}},
	}
}

func findClusterRBACRow(rows []ClusterRBACEntry, kind, name string) *ClusterRBACEntry {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func clusterRBACDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(clusterRBACDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no cluster-rbac descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

// TestClusterRBACMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary. The domain is cluster-scoped, so
// objects carry no namespace and the store is queried for all rows ("").
func TestClusterRBACMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	roleDesc := clusterRBACDescriptor(t, "clusterroles")
	bindingDesc := clusterRBACDescriptor(t, "clusterrolebindings")
	store := newTypedMaintainedStore(meta, clusterRBACQuerypageSchema(), clusterRBACTableQueryAdapter())
	available := map[string]bool{"ClusterRole": true, "ClusterRoleBinding": true}

	store.ingest(roleDesc, clusterRoleObj("cr-a", "10"))
	store.ingest(roleDesc, clusterRoleObj("cr-b", "12"))
	store.ingest(bindingDesc, clusterRoleBindingObj("crb-a", "8"))

	require.Equal(t, uint64(12), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("", available), 3)

	want := clusterrole.BuildStreamSummary(meta, clusterRoleObj("cr-a", "10"))
	got := findClusterRBACRow(store.rows("", available), "ClusterRole", "cr-a")
	require.NotNil(t, got, "cr-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// Update cr-a in place: new resourceVersion, no duplicate.
	store.ingest(roleDesc, clusterRoleObj("cr-a", "20"))
	require.Equal(t, uint64(20), store.snapshotVersion())
	require.Len(t, store.rows("", available), 3, "in-place update, no duplicate")

	// Delete cr-b directly; delete crb-a via a tombstone.
	store.evict(roleDesc, clusterRoleObj("cr-b", "21"))
	store.evict(bindingDesc, cache.DeletedFinalStateUnknown{Key: "crb-a", Obj: clusterRoleBindingObj("crb-a", "22")})
	require.Nil(t, findClusterRBACRow(store.rows("", available), "ClusterRole", "cr-b"))
	require.Nil(t, findClusterRBACRow(store.rows("", available), "ClusterRoleBinding", "crb-a"))
	require.Len(t, store.rows("", available), 1, "only cr-a remains")
}

// TestClusterRBACMaintainedStoreMatchesListPath is the SAFETY GATE for the live
// cutover: fed the same objects, the maintained store's rows must equal exactly what
// the current list path produces, for the cluster scope.
func TestClusterRBACMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	roleDesc := clusterRBACDescriptor(t, "clusterroles")
	bindingDesc := clusterRBACDescriptor(t, "clusterrolebindings")

	roles := []*rbacv1.ClusterRole{
		clusterRoleObj("alpha", "1"),
		clusterRoleObj("beta", "2"),
	}
	bindings := []*rbacv1.ClusterRoleBinding{
		clusterRoleBindingObj("gamma", "3"),
		clusterRoleBindingObj("delta", "4"),
	}

	roleIdx := newNamespaceIndexer()
	bindingIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, clusterRBACQuerypageSchema(), clusterRBACTableQueryAdapter())
	for _, r := range roles {
		require.NoError(t, roleIdx.Add(r))
		store.ingest(roleDesc, r)
	}
	for _, b := range bindings {
		require.NoError(t, bindingIdx.Add(b))
		store.ingest(bindingDesc, b)
	}

	collect := clusterRBACCollectIndexer(roleIdx, bindingIdx)
	available := map[string]bool{"ClusterRole": true, "ClusterRoleBinding": true}
	listed, _, _, err := collectDescriptorTableRows[ClusterRBACEntry](
		context.Background(), clusterRBACDomainName, collect, meta, "",
	)
	require.NoError(t, err)
	require.ElementsMatch(t, listed, store.rows("", available),
		"maintained store rows must equal the list path for the cluster scope")
}

// TestClusterRBACMaintainedStoreSinkMatchesListPath is the SAFETY GATE for the live
// ingest cutover: fed the projected StreamRow through the ingest Sink (the live
// reflector path ClusterRole/ClusterRoleBinding now take via IngestOwned), the
// maintained store's rows must equal exactly what the list path produces.
func TestClusterRBACMaintainedStoreSinkMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	roleDesc := clusterRBACDescriptor(t, "clusterroles")
	bindingDesc := clusterRBACDescriptor(t, "clusterrolebindings")

	roles := []*rbacv1.ClusterRole{
		clusterRoleObj("alpha", "1"),
		clusterRoleObj("beta", "2"),
	}
	bindings := []*rbacv1.ClusterRoleBinding{
		clusterRoleBindingObj("gamma", "3"),
		clusterRoleBindingObj("delta", "4"),
	}

	roleIdx := newNamespaceIndexer()
	bindingIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, clusterRBACQuerypageSchema(), clusterRBACTableQueryAdapter())
	sink := store.Sink()
	for _, r := range roles {
		require.NoError(t, roleIdx.Add(r))
		sink.Upsert(roleDesc.StreamRow(meta, r))
	}
	for _, b := range bindings {
		require.NoError(t, bindingIdx.Add(b))
		sink.Upsert(bindingDesc.StreamRow(meta, b))
	}

	collect := clusterRBACCollectIndexer(roleIdx, bindingIdx)
	available := map[string]bool{"ClusterRole": true, "ClusterRoleBinding": true}
	listed, _, _, err := collectDescriptorTableRows[ClusterRBACEntry](
		context.Background(), clusterRBACDomainName, collect, meta, "",
	)
	require.NoError(t, err)
	require.ElementsMatch(t, listed, store.rows("", available),
		"sink-fed maintained store rows must equal the list path for the cluster scope")

	sink.Delete(roleDesc.StreamRow(meta, roles[0]))
	require.Nil(t, findClusterRBACRow(store.rows("", available), "ClusterRole", "alpha"))
	require.Greater(t, store.snapshotVersion(), uint64(0), "sink mutations advance the snapshot version")
}

// TestClusterRBACBuilderMaintainedMatchesListPath is the end-to-end cutover proof:
// fed the same objects, a builder serving from the maintained store produces a
// byte-identical snapshot payload to the list-path builder, across window, query,
// filter, and search scopes.
func TestClusterRBACBuilderMaintainedMatchesListPath(t *testing.T) {
	roleDesc := clusterRBACDescriptor(t, "clusterroles")
	bindingDesc := clusterRBACDescriptor(t, "clusterrolebindings")

	roles := []*rbacv1.ClusterRole{
		clusterRoleObj("alpha", "1"),
		clusterRoleObj("beta", "2"),
	}
	bindings := []*rbacv1.ClusterRoleBinding{
		clusterRoleBindingObj("gamma", "3"),
	}

	roleIdx := newNamespaceIndexer()
	bindingIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, clusterRBACQuerypageSchema(), clusterRBACTableQueryAdapter())
	for _, r := range roles {
		require.NoError(t, roleIdx.Add(r))
		maintained.ingest(roleDesc, r)
	}
	for _, b := range bindings {
		require.NoError(t, bindingIdx.Add(b))
		maintained.ingest(bindingDesc, b)
	}

	collect := clusterRBACCollectIndexer(roleIdx, bindingIdx)
	listBuilder := &ClusterRBACBuilder{collectIndexer: collect}
	maintainedBuilder := &ClusterRBACBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"",
		"cluster-a|?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|?limit=50&kinds=ClusterRoleBinding",
		"cluster-a|?search=alpha",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(ClusterRBACSnapshot),
			maintSnap.Payload.(ClusterRBACSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}
