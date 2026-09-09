package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
)

func objectMapNamespacedRBACObjects() []runtime.Object {
	return []runtime.Object{
		&rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "reader"}, Rules: []rbacv1.PolicyRule{{APIGroups: []string{""}, Resources: []string{"pods"}, Verbs: []string{"get"}}}},
		&rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Namespace: "team-b", Name: "reader"}},
		&rbacv1.RoleBinding{
			ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "readers"},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"},
			Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder"}},
		},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "builder"}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: "team-b", Name: "builder"}},
	}
}

func TestObjectMapNamespacedRBACRelationships(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapNamespacedRBACObjects()...))
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	for _, scope := range []string{
		"cluster-a|namespace:team-a",
		"cluster-a|team-a:rbac.authorization.k8s.io/v1:Role:reader",
		"cluster-a|team-a:rbac.authorization.k8s.io/v1:RoleBinding:readers",
	} {
		t.Run(scope, func(t *testing.T) {
			snap, err := builder.Build(ctx, scope)
			require.NoError(t, err)
			payload := snap.Payload.(ObjectMapSnapshotPayload)
			require.Len(t, payload.Nodes, 3)
			assertEdge(t, payload, "RoleBinding", "readers", "Role", "reader", "grants")
			assertEdge(t, payload, "RoleBinding", "readers", "ServiceAccount", "builder", "binds")
			for _, node := range payload.Nodes {
				require.Equal(t, "cluster-a", node.Ref.ClusterID)
				require.Equal(t, "team-a", node.Ref.Namespace)
				require.Equal(t, "v1", node.Ref.Version)
				require.NotEmpty(t, node.Ref.Resource)
				if node.Ref.Kind != "ServiceAccount" {
					require.Equal(t, rbacv1.GroupName, node.Ref.Group)
					require.NotNil(t, node.Status)
				}
			}
		})
	}
}

func TestObjectMapServiceAccountIncludesNamespacedBinding(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapNamespacedRBACObjects()...))
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	snap, err := builder.Build(ctx, "cluster-a|team-a:/v1:ServiceAccount:builder")
	require.NoError(t, err)
	payload := snap.Payload.(ObjectMapSnapshotPayload)
	assertEdge(t, payload, "RoleBinding", "readers", "ServiceAccount", "builder", "binds")
	// A ServiceAccount seed follows incoming links without crossing forward into
	// the binding's role, matching the existing directional traversal contract.
	require.Len(t, payload.Nodes, 2)
}

func TestObjectMapRoleBindingReferencesClusterRoleAndCrossNamespaceSubject(t *testing.T) {
	objects := objectMapNamespacedRBACObjects()
	objects[2].(*rbacv1.RoleBinding).RoleRef.Kind = "ClusterRole"
	objects[2].(*rbacv1.RoleBinding).Subjects = []rbacv1.Subject{
		{Kind: "ServiceAccount", Namespace: "team-b", Name: "builder"},
		{Kind: "ServiceAccount", Name: "missing"},
		{Kind: "User", APIGroup: rbacv1.GroupName, Name: "alice"},
		{Kind: "Group", APIGroup: rbacv1.GroupName, Name: "developers"},
		{Kind: "ServiceAccount"},
	}
	objects = append(objects, &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "reader"}})
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objects...))
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-b"})
	snap, err := builder.Build(ctx, "cluster-b|team-a:rbac.authorization.k8s.io/v1:RoleBinding:readers")
	require.NoError(t, err)
	payload := snap.Payload.(ObjectMapSnapshotPayload)
	require.Len(t, payload.Nodes, 3)
	require.Len(t, payload.Edges, 2)
	assertEdge(t, payload, "RoleBinding", "readers", "ClusterRole", "reader", "grants")
	assertEdge(t, payload, "RoleBinding", "readers", "ServiceAccount", "builder", "binds")
	for _, node := range payload.Nodes {
		require.Equal(t, "cluster-b", node.Ref.ClusterID)
	}
	require.Empty(t, nodeByKindName(t, payload, "ClusterRole", "reader").Ref.Namespace)
	require.Equal(t, "team-b", nodeByKindName(t, payload, "ServiceAccount", "builder").Ref.Namespace)

	snap, err = builder.Build(ctx, "cluster-b|namespace:team-a")
	require.NoError(t, err)
	payload = snap.Payload.(ObjectMapSnapshotPayload)
	assertEdge(t, payload, "RoleBinding", "readers", "ClusterRole", "reader", "grants")
	// Namespace maps keep other namespaces out even when a binding names a subject there.
	for _, node := range payload.Nodes {
		require.NotEqual(t, "team-b", node.Ref.Namespace)
	}
}

func TestObjectMapNamespacedRBACPermissionDenial(t *testing.T) {
	for _, denied := range []struct{ resource, kind, name string }{
		{"roles", "Role", "reader"},
		{"rolebindings", "RoleBinding", "readers"},
	} {
		t.Run(denied.resource, func(t *testing.T) {
			builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapNamespacedRBACObjects()...))
			builder.permissions = denyPermissions{denied: map[string]bool{denied.resource: true}}
			ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
			snap, err := builder.Build(ctx, "cluster-a|namespace:team-a")
			require.NoError(t, err)
			payload := snap.Payload.(ObjectMapSnapshotPayload)
			assertMissingNode(t, payload, denied.kind, denied.name)
			assertNode(t, payload, "ServiceAccount", "builder")
			require.Len(t, payload.Nodes, 2)
			require.Contains(t, payload.Warnings, "skipped "+denied.resource+": insufficient permissions")
			if denied.resource == "roles" {
				assertEdge(t, payload, "RoleBinding", "readers", "ServiceAccount", "builder", "binds")
			}
		})
	}
}
