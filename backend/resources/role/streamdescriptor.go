/*
 * backend/resources/role/streamdescriptor.go
 *
 * Role's resource-stream registry entry. The manager loops the registry; this is
 * the only place Role's informer + row projection are wired.
 */

package role

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers Role for resource streaming (namespace-rbac).
var StreamDescriptor = streamspec.Descriptor{
	Group:    Identity.Group,
	Version:  Identity.Version,
	Kind:     Identity.Kind,
	Resource: Identity.Resource,
	Domain:   "namespace-rbac",
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*rbacv1.Role))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Rbac().V1().Roles().Informer()
	},
}
