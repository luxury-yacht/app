/*
 * backend/resourcecontract/builtin_resources.go
 *
 * Owns the built-in Kubernetes resource identity contract shared by catalog
 * identity resolution, refresh permission composition, and typed detail gates.
 *
 * Each kind's identity is declared once, in its own resources/<kind> package, as
 * a resourcekind.Identity. This file aggregates those declarations into the
 * authoritative ordered table instead of restating any kind's GVK. The only
 * literal rows left are catalog-only kinds that have no resource package of their
 * own (identity only: no model, detail, or object-map behaviour).
 */

package resourcecontract

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcekind"
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
	jobres "github.com/luxury-yacht/app/backend/resources/job"
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
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const builtinStorageAPIGroup = "storage.k8s.io"

// BuiltinResource describes one built-in Kubernetes resource identity.
type BuiltinResource = resourcekind.Identity

// BuiltinResources is the authoritative in-repo resource identity table for
// built-ins that Luxury Yacht handles without dynamic discovery. Every row is
// sourced from the owning kind package's resourcekind.Identity; the only
// exceptions are catalog-only kinds with no resource package (Endpoints,
// CSIDriver, CSINode, VolumeAttachment, Lease), declared inline here.
var BuiltinResources = []BuiltinResource{
	pods.Identity,
	service.Identity,
	configmap.Identity,
	secretpkg.Identity,
	serviceaccount.Identity,
	events.Identity,
	limitrange.Identity,
	resourcequota.Identity,
	builtin("", "v1", "Endpoints", "endpoints", true), // catalog-only: no resource package
	persistentvolumeclaim.Identity,
	namespaces.Identity,
	nodes.Identity,
	persistentvolume.Identity,

	deployment.Identity,
	statefulset.Identity,
	daemonset.Identity,
	replicaset.Identity,

	jobres.Identity,
	cronjob.Identity,

	hpa.IdentityV1,
	hpa.Identity,

	ingress.Identity,
	networkpolicy.Identity,
	ingressclass.Identity,

	endpointslice.Identity,

	gateway.Identity,
	httproute.Identity,
	grpcroute.Identity,
	tlsroute.Identity,
	listenerset.Identity,
	backendtlspolicy.Identity,
	referencegrant.Identity,
	gatewayclass.Identity,

	role.Identity,
	rolebinding.Identity,
	clusterrole.Identity,
	clusterrolebinding.Identity,

	poddisruptionbudget.Identity,

	storageclass.Identity,
	builtin(builtinStorageAPIGroup, "v1", "CSIDriver", "csidrivers", false),               // catalog-only: no resource package
	builtin(builtinStorageAPIGroup, "v1", "CSINode", "csinodes", false),                   // catalog-only: no resource package
	builtin(builtinStorageAPIGroup, "v1", "VolumeAttachment", "volumeattachments", false), // catalog-only: no resource package

	admission.MutatingIdentity,
	admission.ValidatingIdentity,

	builtin("coordination.k8s.io", "v1", "Lease", "leases", true), // catalog-only: no resource package

	apiextensions.Identity,
}

// builtin declares a contract row inline, for catalog-only kinds that have no
// resource package to own their identity.
func builtin(group, version, kind, resource string, namespaced bool) BuiltinResource {
	return BuiltinResource{
		Group:      group,
		Version:    version,
		Kind:       kind,
		Resource:   resource,
		Namespaced: namespaced,
	}
}

// FindBuiltin returns a built-in resource by exact group/version/kind.
func FindBuiltin(group, version, kind string) (BuiltinResource, bool) {
	key := resourceKey(group, version, kind)
	for _, resource := range BuiltinResources {
		if resourceKey(resource.Group, resource.Version, resource.Kind) == key {
			return resource, true
		}
	}
	return BuiltinResource{}, false
}

// MustBuiltin returns a built-in resource and panics if the contract is missing it.
func MustBuiltin(group, version, kind string) BuiltinResource {
	resource, ok := FindBuiltin(group, version, kind)
	if !ok {
		panic("missing built-in resource contract for " + schema.GroupVersionKind{
			Group:   group,
			Version: version,
			Kind:    kind,
		}.String())
	}
	return resource
}

func resourceKey(group, version, kind string) string {
	return strings.TrimSpace(group) + "/" +
		strings.TrimSpace(version) + "/" +
		strings.ToLower(strings.TrimSpace(kind))
}
