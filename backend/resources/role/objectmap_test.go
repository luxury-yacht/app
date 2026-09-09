package role

import (
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	"testing"
)

func TestObjectMapNodeProjectsRBACStatus(t *testing.T) {
	obj := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "reader"}, Rules: []rbacv1.PolicyRule{{Resources: []string{"pods"}, Verbs: []string{"get"}}}}
	factory := informers.NewSharedInformerFactory(fake.NewClientset(), 0)
	require.NoError(t, factory.Rbac().V1().Roles().Informer().GetIndexer().Add(obj))
	objects, err := ObjectMapNode.List(factory)
	require.NoError(t, err)
	require.Len(t, objects, 1)
	status := ObjectMapNode.Status("cluster-a", objects[0])
	require.Equal(t, "Rules: 1", status.Label)
	require.Equal(t, "1", status.State)
	require.Equal(t, "ready", status.Presentation)
	deletion := metav1.Now()
	obj.DeletionTimestamp = &deletion
	status = ObjectMapNode.Status("cluster-a", obj)
	require.Equal(t, "terminating", status.Presentation)
}
