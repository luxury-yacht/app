/*
 * backend/resources/grpcroute/streamdescriptor.go
 *
 * GRPCRoute's resource-stream registry entry (Gateway-API informer factory).
 */

package grpcroute

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
)

// StreamDescriptor registers GRPCRoute for resource streaming (namespace-network).
var StreamDescriptor = streamspec.Descriptor{
	Group:    Identity.Group,
	Version:  Identity.Version,
	Kind:     Identity.Kind,
	Resource: Identity.Resource,
	Domain:   "namespace-network",
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*gatewayv1.GRPCRoute))
	},
	GatewayInformer: func(factory gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Gateway().V1().GRPCRoutes().Informer()
	},
}
