package rolebinding

import (
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	"testing"
)

func TestObjectMapNodeProjectsRBACStatus(t *testing.T) {
	obj := &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "reader"}, RoleRef: rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"}, Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder"}}}
	factory := informers.NewSharedInformerFactory(fake.NewClientset(), 0)
	require.NoError(t, factory.Rbac().V1().RoleBindings().Informer().GetIndexer().Add(obj))
	objects, err := ObjectMapNode.List(factory)
	require.NoError(t, err)
	require.Len(t, objects, 1)
	status := ObjectMapNode.Status("cluster-a", objects[0])
	require.Equal(t, "Role: reader, Subjects: 1", status.Label)
	require.Equal(t, "1", status.State)
	require.Equal(t, "ready", status.Presentation)
	deletion := metav1.Now()
	obj.DeletionTimestamp = &deletion
	status = ObjectMapNode.Status("cluster-a", obj)
	require.Equal(t, "terminating", status.Presentation)
}

func TestObjectMapEdgesRequireRoleBinding(t *testing.T) {
	require.Nil(t, ObjectMapEdges("cluster-a", &rbacv1.Role{}))
	binding := &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "readers"}, RoleRef: rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "reader"}}
	edges := ObjectMapEdges("cluster-a", binding)
	require.Len(t, edges, 1)
	require.Equal(t, "ClusterRole", edges[0].Link.Ref.Kind)
	require.Empty(t, edges[0].Link.Ref.Namespace)
}
