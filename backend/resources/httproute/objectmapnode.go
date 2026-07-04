package httproute

import (
	"context"

	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
)

// ObjectMapNode declares how the object map collects this Gateway-API kind (a live
// LIST via the Gateway client) and projects each object into a graph node.
var ObjectMapNode = objectmapnode.GatewayCollector{
	Identity: Identity,
	List: func(ctx context.Context, client gatewayversioned.Interface, namespace string) ([]metav1.Object, error) {
		if namespace == "" {
			namespace = metav1.NamespaceAll
		}
		list, err := client.GatewayV1().HTTPRoutes(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, err
		}
		out := make([]metav1.Object, 0, len(list.Items))
		for i := range list.Items {
			out = append(out, &list.Items[i])
		}
		return out, nil
	},
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*gatewayv1.HTTPRoute))
	},
}
