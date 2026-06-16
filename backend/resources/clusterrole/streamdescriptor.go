/*
 * backend/resources/clusterrole/streamdescriptor.go
 *
 * ClusterRole's resource-stream registry entry.
 */

package clusterrole

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers ClusterRole for resource streaming (cluster-rbac).
var StreamDescriptor = streamspec.Descriptor{
	Group:         "rbac.authorization.k8s.io",
	Version:       "v1",
	Kind:          "ClusterRole",
	Resource:      "clusterroles",
	Domain:        "cluster-rbac",
	ClusterScoped: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*rbacv1.ClusterRole))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Rbac().V1().ClusterRoles().Informer()
	},
}
