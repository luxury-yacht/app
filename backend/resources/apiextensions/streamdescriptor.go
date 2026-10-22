/*
 * backend/resources/apiextensions/streamdescriptor.go
 *
 * CustomResourceDefinition's resource-stream registry entry. One owned
 * reflector feeds the cluster-crds table, the object catalog, API discovery's
 * staleness hook, and the dynamic custom-resource sources (the Definition
 * aggregate).
 */

package apiextensions

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StreamDescriptor registers CustomResourceDefinition for the cluster-crds
// snapshot domain.
var StreamDescriptor = streamspec.Descriptor{
	Group:         Identity.Group,
	Version:       Identity.Version,
	Kind:          Identity.Kind,
	Resource:      Identity.Resource,
	Domain:        "cluster-crds",
	ClusterScoped: !Identity.Namespaced,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*apiextensionsv1.CustomResourceDefinition))
	},
	AggregateRow: func(obj metav1.Object) any {
		return BuildDefinition(obj.(*apiextensionsv1.CustomResourceDefinition))
	},
}
