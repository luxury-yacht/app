/*
 * backend/resources/networkpolicy/streamdescriptor.go
 *
 * NetworkPolicy's resource-stream registry entry.
 */

package networkpolicy

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StreamDescriptor registers NetworkPolicy for resource streaming (namespace-network).
var StreamDescriptor = streamspec.Descriptor{
	Group:    Identity.Group,
	Version:  Identity.Version,
	Kind:     Identity.Kind,
	Resource: Identity.Resource,
	Domain:   "namespace-network",
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*networkingv1.NetworkPolicy))
	},
}
