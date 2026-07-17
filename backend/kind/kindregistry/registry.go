/*
 * backend/kind/kindregistry/registry.go
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
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
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
	"github.com/luxury-yacht/app/backend/resources/events"
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
// All is the single source of truth for every built-in kind: each kind package
// registers its one Descriptor here. Subsystems loop this and filter by facet;
// none of them names a kind itself. Adding a kind = create resources/<kind>/
// (with its descriptor.go) and add one line here.
var All = []kindspec.Descriptor{
	pods.Descriptor,
	deployment.Descriptor,
	replicaset.Descriptor,
	statefulset.Descriptor,
	daemonset.Descriptor,
	job.Descriptor,
	cronjob.Descriptor,
	service.Descriptor,
	endpointslice.Descriptor,
	configmap.Descriptor,
	secret.Descriptor,
	persistentvolumeclaim.Descriptor,
	persistentvolume.Descriptor,
	resourcequota.Descriptor,
	limitrange.Descriptor,
	namespaces.Descriptor,
	nodes.Descriptor,
	ingress.Descriptor,
	networkpolicy.Descriptor,
	hpa.Descriptor,
	clusterrole.Descriptor,
	clusterrolebinding.Descriptor,
	role.Descriptor,
	rolebinding.Descriptor,
	storageclass.Descriptor,
	serviceaccount.Descriptor,
	ingressclass.Descriptor,
	poddisruptionbudget.Descriptor,
	admission.MutatingDescriptor,
	admission.ValidatingDescriptor,
	apiextensions.Descriptor,
	events.Descriptor,
	gatewayclass.Descriptor,
	gateway.Descriptor,
	httproute.Descriptor,
	grpcroute.Descriptor,
	tlsroute.Descriptor,
	listenerset.Descriptor,
	referencegrant.Descriptor,
	backendtlspolicy.Descriptor,
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
