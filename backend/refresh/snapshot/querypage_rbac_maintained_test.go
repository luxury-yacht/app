package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/role"
)

func roleObj(ns, name, rv string) *rbacv1.Role {
	return &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Rules:      []rbacv1.PolicyRule{{APIGroups: []string{""}}},
	}
}

func roleBindingObj(ns, name, rv string) *rbacv1.RoleBinding {
	return &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		RoleRef:    rbacv1.RoleRef{Kind: "Role", Name: "edit"},
		Subjects:   []rbacv1.Subject{{Kind: "User", Name: "alice"}},
	}
}

func saObjRBAC(ns, name, rv string) *corev1.ServiceAccount {
	return &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Secrets:    []corev1.ObjectReference{{Name: name + "-token"}},
	}
}

func findRBACRow(rows []RBACSummary, kind, ns, name string) *RBACSummary {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Namespace == ns && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func rbacDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceRBACDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no namespace-rbac descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

// TestRBACMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary.
func TestRBACMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	roleDesc := rbacDescriptor(t, "roles")
	bindingDesc := rbacDescriptor(t, "rolebindings")
	saDesc := rbacDescriptor(t, "serviceaccounts")
	store := newTypedMaintainedStore(meta, rbacQuerypageSchema(), rbacTableQueryAdapter())
	available := map[string]bool{"Role": true, "RoleBinding": true, "ServiceAccount": true}

	store.ingest(roleDesc, roleObj("default", "r-a", "10"))
	store.ingest(bindingDesc, roleBindingObj("default", "b-a", "12"))
	store.ingest(saDesc, saObjRBAC("kube-system", "sa-a", "8"))
	store.ingest(roleDesc, roleObj("default", "r-b", "15"))

	require.Equal(t, uint64(15), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("default", available), 3)
	require.Len(t, store.rows("", available), 4)
	require.Len(t, store.rows("kube-system", available), 1)

	want := role.BuildStreamSummary(meta, roleObj("default", "r-a", "10"))
	got := findRBACRow(store.rows("default", available), "Role", "default", "r-a")
	require.NotNil(t, got, "r-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// Update r-a in place: new resourceVersion, no duplicate.
	store.ingest(roleDesc, roleObj("default", "r-a", "20"))
	require.Equal(t, uint64(20), store.snapshotVersion())
	require.Len(t, store.rows("default", available), 3, "in-place update, no duplicate")

	// Delete b-a directly; delete sa-a via a tombstone.
	store.evict(bindingDesc, roleBindingObj("default", "b-a", "21"))
	store.evict(saDesc, cache.DeletedFinalStateUnknown{Key: "kube-system/sa-a", Obj: saObjRBAC("kube-system", "sa-a", "22")})
	require.Nil(t, findRBACRow(store.rows("default", available), "RoleBinding", "default", "b-a"))
	require.Nil(t, findRBACRow(store.rows("kube-system", available), "ServiceAccount", "kube-system", "sa-a"))
	require.Len(t, store.rows("default", available), 2, "r-a and r-b remain in default")
}

// TestRBACMaintainedStoreMatchesListPath is the SAFETY GATE for the live cutover:
// fed the same objects, the maintained store's rows must equal exactly what the
// current list path produces, for every namespace scope.
func TestRBACMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	roleDesc := rbacDescriptor(t, "roles")
	bindingDesc := rbacDescriptor(t, "rolebindings")
	saDesc := rbacDescriptor(t, "serviceaccounts")

	roles := []*rbacv1.Role{
		roleObj("default", "alpha", "1"),
		roleObj("app", "beta", "2"),
	}
	bindings := []*rbacv1.RoleBinding{
		roleBindingObj("default", "gamma", "3"),
		roleBindingObj("kube-system", "delta", "4"),
	}
	sas := []*corev1.ServiceAccount{
		saObjRBAC("default", "epsilon", "5"),
		saObjRBAC("kube-system", "zeta", "6"),
	}

	roleIdx := newNamespaceIndexer()
	bindingIdx := newNamespaceIndexer()
	saIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, rbacQuerypageSchema(), rbacTableQueryAdapter())
	for _, r := range roles {
		require.NoError(t, roleIdx.Add(r))
		store.ingest(roleDesc, r)
	}
	for _, b := range bindings {
		require.NoError(t, bindingIdx.Add(b))
		store.ingest(bindingDesc, b)
	}
	for _, s := range sas {
		require.NoError(t, saIdx.Add(s))
		store.ingest(saDesc, s)
	}

	collect := rbacCollectIndexer(roleIdx, bindingIdx, saIdx)
	available := map[string]bool{"Role": true, "RoleBinding": true, "ServiceAccount": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[RBACSummary](
			context.Background(), namespaceRBACDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"maintained store rows must equal the list path for namespace %q", ns)
	}
}

// TestRBACMaintainedStoreSinkMatchesListPath is the SAFETY GATE for the live ingest
// cutover: fed the projected StreamRow through the ingest Sink (the live reflector
// path Role/RoleBinding/ServiceAccount now take via IngestOwned), the maintained
// store's rows must equal exactly what the list path produces, for every namespace.
func TestRBACMaintainedStoreSinkMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	roleDesc := rbacDescriptor(t, "roles")
	bindingDesc := rbacDescriptor(t, "rolebindings")
	saDesc := rbacDescriptor(t, "serviceaccounts")

	roles := []*rbacv1.Role{
		roleObj("default", "alpha", "1"),
		roleObj("app", "beta", "2"),
	}
	bindings := []*rbacv1.RoleBinding{
		roleBindingObj("default", "gamma", "3"),
		roleBindingObj("kube-system", "delta", "4"),
	}
	sas := []*corev1.ServiceAccount{
		saObjRBAC("default", "epsilon", "5"),
		saObjRBAC("kube-system", "zeta", "6"),
	}

	roleIdx := newNamespaceIndexer()
	bindingIdx := newNamespaceIndexer()
	saIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, rbacQuerypageSchema(), rbacTableQueryAdapter())
	sink := store.Sink()
	for _, r := range roles {
		require.NoError(t, roleIdx.Add(r))
		sink.Upsert(roleDesc.StreamRow(meta, r))
	}
	for _, b := range bindings {
		require.NoError(t, bindingIdx.Add(b))
		sink.Upsert(bindingDesc.StreamRow(meta, b))
	}
	for _, s := range sas {
		require.NoError(t, saIdx.Add(s))
		sink.Upsert(saDesc.StreamRow(meta, s))
	}

	collect := rbacCollectIndexer(roleIdx, bindingIdx, saIdx)
	available := map[string]bool{"Role": true, "RoleBinding": true, "ServiceAccount": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[RBACSummary](
			context.Background(), namespaceRBACDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"sink-fed maintained store rows must equal the list path for namespace %q", ns)
	}

	sink.Delete(roleDesc.StreamRow(meta, roles[0]))
	require.Nil(t, findRBACRow(store.rows("default", available), "Role", "default", "alpha"))
	require.Greater(t, store.snapshotVersion(), uint64(0), "sink mutations advance the snapshot version")
}

// TestNamespaceRBACBuilderMaintainedMatchesListPath is the end-to-end cutover proof:
// fed the same objects, a builder serving from the maintained store produces a
// byte-identical snapshot payload to the list-path builder, across window, query,
// filter, and search scopes.
func TestNamespaceRBACBuilderMaintainedMatchesListPath(t *testing.T) {
	roleDesc := rbacDescriptor(t, "roles")
	bindingDesc := rbacDescriptor(t, "rolebindings")
	saDesc := rbacDescriptor(t, "serviceaccounts")

	roles := []*rbacv1.Role{
		roleObj("default", "alpha", "1"),
		roleObj("app", "beta", "2"),
	}
	bindings := []*rbacv1.RoleBinding{
		roleBindingObj("default", "gamma", "3"),
	}
	sas := []*corev1.ServiceAccount{
		saObjRBAC("default", "epsilon", "5"),
		saObjRBAC("kube-system", "zeta", "6"),
	}

	roleIdx := newNamespaceIndexer()
	bindingIdx := newNamespaceIndexer()
	saIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, rbacQuerypageSchema(), rbacTableQueryAdapter())
	for _, r := range roles {
		require.NoError(t, roleIdx.Add(r))
		maintained.ingest(roleDesc, r)
	}
	for _, b := range bindings {
		require.NoError(t, bindingIdx.Add(b))
		maintained.ingest(bindingDesc, b)
	}
	for _, s := range sas {
		require.NoError(t, saIdx.Add(s))
		maintained.ingest(saDesc, s)
	}

	collect := rbacCollectIndexer(roleIdx, bindingIdx, saIdx)
	listBuilder := &NamespaceRBACBuilder{collectIndexer: collect}
	maintainedBuilder := &NamespaceRBACBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"namespace:default",
		"namespace:all",
		"cluster-a|namespace:all?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|namespace:all?limit=50&kinds=ServiceAccount",
		"cluster-a|namespace:all?search=alpha",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceRBACSnapshot),
			maintSnap.Payload.(NamespaceRBACSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}
