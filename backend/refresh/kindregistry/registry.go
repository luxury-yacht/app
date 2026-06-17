/*
 * backend/refresh/kindregistry/registry.go
 *
 * THE registry. Every built-in kind is registered here exactly once, with its
 * identity and the facets each subsystem needs. The object catalog, resource
 * stream, snapshot stream-summary, object map, detail bindings, and response-cache
 * invalidation all loop this one list and filter by facet — none of them names a
 * kind itself. Adding a kind = create resources/<kind>/ and add one entry here.
 *
 * This package is the only aggregator that imports every kind package; the kind
 * packages import only leaves (kindspec + facet leaves), so there is no cycle.
 */

package kindregistry

import (
	"github.com/luxury-yacht/app/backend/refresh/kindspec"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	"github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/namespaces"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
)

// All is the single source of truth for every built-in kind. Order groups kinds
// by catalog source for readability; subsystems never rely on order except where
// noted (object-map collection order is preserved by the snapshot loops).
var All = []kindspec.Descriptor{
	// ---- core / apps / batch, shared informer ----
	{
		Identity:        pods.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &pods.ObjectMapNode,
		Edges:           pods.ObjectMapEdges,
		// Pod detail is served by a bespoke path (PodDetailInfo), not a binding.
	},
	{
		Identity:        deployment.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &deployment.ObjectMapNode,
		Edges:           deployment.ObjectMapEdges,
		Binding:         &deployment.DetailBinding,
	},
	{
		Identity:        replicaset.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &replicaset.ObjectMapNode,
		Edges:           replicaset.ObjectMapEdges,
		Binding:         &replicaset.DetailBinding,
	},
	{
		Identity:        statefulset.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &statefulset.ObjectMapNode,
		Edges:           statefulset.ObjectMapEdges,
		Binding:         &statefulset.DetailBinding,
	},
	{
		Identity:        daemonset.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &daemonset.ObjectMapNode,
		Edges:           daemonset.ObjectMapEdges,
		Binding:         &daemonset.DetailBinding,
	},
	{
		Identity:        job.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &job.ObjectMapNode,
		Edges:           job.ObjectMapEdges,
		Binding:         &job.DetailBinding,
	},
	{
		Identity:        cronjob.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &cronjob.ObjectMapNode,
		Edges:           cronjob.ObjectMapEdges,
		Binding:         &cronjob.DetailBinding,
	},
	{
		Identity:        service.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &service.ObjectMapNode,
		Edges:           service.ObjectMapEdges,
		Binding:         &service.DetailBinding,
	},
	{
		Identity:        endpointslice.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &endpointslice.ObjectMapNode,
		Edges:           endpointslice.ObjectMapEdges,
		Binding:         &endpointslice.DetailBinding,
	},
	{
		Identity:        configmap.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &configmap.StreamDescriptor,
		Collector:       &configmap.ObjectMapNode,
		Binding:         &configmap.DetailBinding,
	},
	{
		Identity:        secret.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &secret.StreamDescriptor,
		Collector:       &secret.ObjectMapNode,
		Binding:         &secret.DetailBinding,
	},
	{
		Identity:        persistentvolumeclaim.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &persistentvolumeclaim.StreamDescriptor,
		Collector:       &persistentvolumeclaim.ObjectMapNode,
		Edges:           persistentvolumeclaim.ObjectMapEdges,
		Binding:         &persistentvolumeclaim.DetailBinding,
	},
	{
		Identity:        persistentvolume.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &persistentvolume.StreamDescriptor,
		Collector:       &persistentvolume.ObjectMapNode,
		Edges:           persistentvolume.ObjectMapEdges,
		Binding:         &persistentvolume.DetailBinding,
	},
	{
		Identity:        resourcequota.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &resourcequota.StreamDescriptor,
		Binding:         &resourcequota.DetailBinding,
	},
	{
		Identity:        limitrange.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &limitrange.StreamDescriptor,
		Binding:         &limitrange.DetailBinding,
	},
	{
		Identity:        namespaces.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Binding:         &namespaces.DetailBinding,
	},
	{
		Identity:        nodes.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Collector:       &nodes.ObjectMapNode,
		Binding:         &nodes.DetailBinding,
	},
	// ---- networking, shared informer ----
	{
		Identity:        ingress.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &ingress.StreamDescriptor,
		Collector:       &ingress.ObjectMapNode,
		Edges:           ingress.ObjectMapEdges,
		Binding:         &ingress.DetailBinding,
	},
	{
		Identity:        networkpolicy.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &networkpolicy.StreamDescriptor,
		Collector:       &networkpolicy.ObjectMapNode,
		Edges:           networkpolicy.ObjectMapEdges,
		Binding:         &networkpolicy.DetailBinding,
	},
	// ---- autoscaling, shared informer (catalog/cache/stream use autoscaling/v1;
	//      detail binding uses autoscaling/v2 via hpa.DetailBinding) ----
	{
		Identity:        hpa.IdentityV1,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &hpa.StreamDescriptor,
		Edges:           hpa.ObjectMapEdges,
		Binding:         &hpa.DetailBinding,
	},
	// ---- rbac, shared informer ----
	{
		Identity:        clusterrole.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &clusterrole.StreamDescriptor,
		Collector:       &clusterrole.ObjectMapNode,
		Edges:           clusterrole.ObjectMapEdges,
		Binding:         &clusterrole.DetailBinding,
	},
	{
		Identity:        clusterrolebinding.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &clusterrolebinding.StreamDescriptor,
		Collector:       &clusterrolebinding.ObjectMapNode,
		Edges:           clusterrolebinding.ObjectMapEdges,
		Binding:         &clusterrolebinding.DetailBinding,
	},
	{
		Identity:        role.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &role.StreamDescriptor,
		Binding:         &role.DetailBinding,
	},
	{
		Identity:        rolebinding.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &rolebinding.StreamDescriptor,
		Binding:         &rolebinding.DetailBinding,
	},
	// ---- storage, shared informer ----
	{
		Identity:        storageclass.Identity,
		CatalogSource:   kindspec.CatalogShared,
		DetailCacheable: true,
		Stream:          &storageclass.StreamDescriptor,
		Collector:       &storageclass.ObjectMapNode,
		Binding:         &storageclass.DetailBinding,
	},
	// ---- kinds the catalog lists dynamically but that still stream / project /
	//      cache via their shared informer ----
	{
		Identity:        serviceaccount.Identity,
		CatalogSource:   kindspec.CatalogDynamic,
		DetailCacheable: true,
		Stream:          &serviceaccount.StreamDescriptor,
		Collector:       &serviceaccount.ObjectMapNode,
		Binding:         &serviceaccount.DetailBinding,
	},
	{
		Identity:        ingressclass.Identity,
		CatalogSource:   kindspec.CatalogDynamic,
		DetailCacheable: true,
		Stream:          &ingressclass.StreamDescriptor,
		Collector:       &ingressclass.ObjectMapNode,
		Binding:         &ingressclass.DetailBinding,
	},
	{
		Identity:        poddisruptionbudget.Identity,
		CatalogSource:   kindspec.CatalogDynamic,
		DetailCacheable: true,
		Stream:          &poddisruptionbudget.StreamDescriptor,
		Collector:       &poddisruptionbudget.ObjectMapNode,
		Edges:           poddisruptionbudget.ObjectMapEdges,
		Binding:         &poddisruptionbudget.DetailBinding,
	},
	{
		Identity:        admission.MutatingIdentity,
		CatalogSource:   kindspec.CatalogDynamic,
		DetailCacheable: true,
		Stream:          &admission.MutatingStreamDescriptor,
		Binding:         &admission.MutatingDetailBinding,
	},
	{
		Identity:        admission.ValidatingIdentity,
		CatalogSource:   kindspec.CatalogDynamic,
		DetailCacheable: true,
		Stream:          &admission.ValidatingStreamDescriptor,
		Binding:         &admission.ValidatingDetailBinding,
	},
	// ---- apiextensions informer ----
	{
		Identity:        apiextensions.Identity,
		CatalogSource:   kindspec.CatalogAPIExtensions,
		DetailCacheable: true,
		// CRD detail is served by a bespoke path (CustomResourceDefinitionDetails).
	},
	// ---- Gateway-API informer ----
	{
		Identity:         gatewayclass.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &gatewayclass.StreamDescriptor,
		GatewayCollector: &gatewayclass.ObjectMapNode,
		Edges:            gatewayclass.ObjectMapEdges,
		Binding:          &gatewayclass.DetailBinding,
	},
	{
		Identity:         gateway.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &gateway.StreamDescriptor,
		GatewayCollector: &gateway.ObjectMapNode,
		Edges:            gateway.ObjectMapEdges,
		Binding:          &gateway.DetailBinding,
	},
	{
		Identity:         httproute.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &httproute.StreamDescriptor,
		GatewayCollector: &httproute.ObjectMapNode,
		Edges:            httproute.ObjectMapEdges,
		Binding:          &httproute.DetailBinding,
	},
	{
		Identity:         grpcroute.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &grpcroute.StreamDescriptor,
		GatewayCollector: &grpcroute.ObjectMapNode,
		Edges:            grpcroute.ObjectMapEdges,
		Binding:          &grpcroute.DetailBinding,
	},
	{
		Identity:         tlsroute.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &tlsroute.StreamDescriptor,
		GatewayCollector: &tlsroute.ObjectMapNode,
		Edges:            tlsroute.ObjectMapEdges,
		Binding:          &tlsroute.DetailBinding,
	},
	{
		Identity:         listenerset.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &listenerset.StreamDescriptor,
		GatewayCollector: &listenerset.ObjectMapNode,
		Edges:            listenerset.ObjectMapEdges,
		Binding:          &listenerset.DetailBinding,
	},
	{
		Identity:         referencegrant.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &referencegrant.StreamDescriptor,
		GatewayCollector: &referencegrant.ObjectMapNode,
		Edges:            referencegrant.ObjectMapEdges,
		Binding:          &referencegrant.DetailBinding,
	},
	{
		Identity:         backendtlspolicy.Identity,
		CatalogSource:    kindspec.CatalogGateway,
		DetailCacheable:  true,
		Stream:           &backendtlspolicy.StreamDescriptor,
		GatewayCollector: &backendtlspolicy.ObjectMapNode,
		Edges:            backendtlspolicy.ObjectMapEdges,
		Binding:          &backendtlspolicy.DetailBinding,
	},
}

// StreamDescriptors returns every directly-streamed kind's stream descriptor, in
// registry order. Resource-stream loops this to register informers and project
// rows; it never names a kind itself.
func StreamDescriptors() []streamspec.Descriptor {
	out := make([]streamspec.Descriptor, 0, len(All))
	for _, d := range All {
		if d.Stream != nil {
			out = append(out, *d.Stream)
		}
	}
	return out
}

// StreamDescriptorsForDomain returns the stream descriptors whose Domain matches,
// in registry order. Snapshot typed-table domains loop this to collect their kinds.
func StreamDescriptorsForDomain(domain string) []streamspec.Descriptor {
	out := []streamspec.Descriptor{}
	for _, d := range All {
		if d.Stream != nil && d.Stream.Domain == domain {
			out = append(out, *d.Stream)
		}
	}
	return out
}
