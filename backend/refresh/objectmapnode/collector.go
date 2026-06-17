// Package objectmapnode is the leaf that lets each kind declare how the object-map
// collects it: how to list its objects from the shared informer factory and how to
// project each into a graph node's status (and optional action facts). The
// collector loop in snapshot aggregates these declarations and never names a kind.
//
// Live-client kinds that have no shared informer cache (HorizontalPodAutoscaler —
// no v2 informer; the Gateway-API kinds — listed via their own client) are not
// declared here; they remain bespoke collectors in snapshot.
package objectmapnode

import (
	"context"

	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	"github.com/luxury-yacht/app/backend/resourcekind"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
)

// Collector is one shared-informer kind's object-map collection declaration.
type Collector struct {
	Identity resourcekind.Identity
	// List returns the kind's objects from the shared informer factory's cache.
	List func(factory informers.SharedInformerFactory) ([]metav1.Object, error)
	// Status projects an object into its graph-node status.
	Status func(clusterID string, obj metav1.Object) *objectmap.Status
	// ActionFacts projects an object into its node action facts; nil when the kind
	// contributes none.
	ActionFacts func(obj metav1.Object) *objectmap.ActionFacts
}

// GatewayCollector is one Gateway-API kind's object-map collection declaration.
// Gateway-API kinds are listed via their own client (the snapshot has no shared
// informers for them) and contribute no action facts.
type GatewayCollector struct {
	Identity resourcekind.Identity
	// List returns the kind's objects via a live LIST through the Gateway-API client.
	List func(ctx context.Context, client gatewayversioned.Interface) ([]metav1.Object, error)
	// Status projects an object into its graph-node status.
	Status func(clusterID string, obj metav1.Object) *objectmap.Status
}

// Objects adapts a typed object slice (as returned by a typed lister) to the
// []metav1.Object a Collector.List returns.
func Objects[T metav1.Object](items []T) []metav1.Object {
	out := make([]metav1.Object, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}
