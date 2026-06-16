/*
 * backend/resources/gatewayclass/streamdescriptor.go
 *
 * GatewayClass's resource-stream registry entry (Gateway-API informer factory).
 */

package gatewayclass

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers GatewayClass for resource streaming (cluster-config).
var StreamDescriptor = streamspec.Descriptor{
	Group:         "gateway.networking.k8s.io",
	Version:       "v1",
	Kind:          "GatewayClass",
	Resource:      "gatewayclasses",
	Domain:        "cluster-config",
	ClusterScoped: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*gatewayv1.GatewayClass))
	},
	GatewayInformer: func(factory gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Gateway().V1().GatewayClasses().Informer()
	},
}
