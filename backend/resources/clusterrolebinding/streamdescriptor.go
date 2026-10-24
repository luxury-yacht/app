/*
 * backend/resources/clusterrolebinding/streamdescriptor.go
 *
 * ClusterRoleBinding's resource-stream registry entry.
 */

package clusterrolebinding

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StreamDescriptor registers ClusterRoleBinding for resource streaming (cluster-rbac).
var StreamDescriptor = streamspec.Descriptor{
	Group:         Identity.Group,
	Version:       Identity.Version,
	Kind:          Identity.Kind,
	Resource:      Identity.Resource,
	Domain:        "cluster-rbac",
	ClusterScoped: !Identity.Namespaced,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*rbacv1.ClusterRoleBinding))
	},
}
