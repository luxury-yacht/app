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
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

// Shared lists every kind streamed from the shared informer factory via the
// generic descriptor dispatch.
var Shared = []streamspec.Descriptor{
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
}
