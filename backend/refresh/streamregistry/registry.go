/*
 * backend/refresh/streamregistry/registry.go
 *
 * The single place every directly-streamed kind is registered once. Resource-stream
 * loops this; it never names a kind itself. Adding a kind to the stream = create its
 * resources/<kind>/streamdescriptor.go and add one line here.
 */

package streamregistry

import (
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
)

// All lists every kind streamed via the generic descriptor dispatch. Each
// descriptor names whether it is served by the shared or Gateway-API informer
// factory; the manager resolves that when registering.
var All = []streamspec.Descriptor{
	role.StreamDescriptor,
	rolebinding.StreamDescriptor,
	serviceaccount.StreamDescriptor,
	clusterrole.StreamDescriptor,
	clusterrolebinding.StreamDescriptor,
	persistentvolumeclaim.StreamDescriptor,
	persistentvolume.StreamDescriptor,
	resourcequota.StreamDescriptor,
	limitrange.StreamDescriptor,
	poddisruptionbudget.StreamDescriptor,
	storageclass.StreamDescriptor,
	ingressclass.StreamDescriptor,
	admission.ValidatingStreamDescriptor,
	admission.MutatingStreamDescriptor,
	ingress.StreamDescriptor,
	networkpolicy.StreamDescriptor,
	gateway.StreamDescriptor,
	httproute.StreamDescriptor,
	grpcroute.StreamDescriptor,
	tlsroute.StreamDescriptor,
	listenerset.StreamDescriptor,
	referencegrant.StreamDescriptor,
	backendtlspolicy.StreamDescriptor,
	gatewayclass.StreamDescriptor,
}
