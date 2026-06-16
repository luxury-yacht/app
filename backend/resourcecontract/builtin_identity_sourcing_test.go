/*
 * backend/resourcecontract/builtin_identity_sourcing_test.go
 *
 * Guards the single-source rule for kind identities: every packaged kind's
 * identity must come from its own resources/<kind> package, and the contract may
 * only declare a row inline for the few catalog-only kinds that have no package.
 * This fails the moment a packaged kind drifts back into a hand-written literal.
 */

package resourcecontract

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/events"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/namespaces"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/stretchr/testify/require"
)

// packagedKindIdentities lists every identity that is owned by a resources/<kind>
// package. The contract must source each of these from its package, never from a
// duplicate literal.
func packagedKindIdentities() []resourcekind.Identity {
	return []resourcekind.Identity{
		pods.Identity,
		service.Identity,
		configmap.Identity,
		secretpkg.Identity,
		serviceaccount.Identity,
		events.Identity,
		limitrange.Identity,
		resourcequota.Identity,
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
		gatewayapi.GatewayIdentity,
		gatewayapi.HTTPRouteIdentity,
		gatewayapi.GRPCRouteIdentity,
		gatewayapi.TLSRouteIdentity,
		gatewayapi.ListenerSetIdentity,
		gatewayapi.BackendTLSPolicyIdentity,
		gatewayapi.ReferenceGrantIdentity,
		gatewayapi.GatewayClassIdentity,
		role.Identity,
		rolebinding.Identity,
		clusterrole.Identity,
		clusterrolebinding.Identity,
		poddisruptionbudget.Identity,
		storageclass.Identity,
		admission.MutatingIdentity,
		admission.ValidatingIdentity,
		apiextensions.Identity,
	}
}

// catalogOnlyKeys are the only kinds allowed to be declared inline in the
// contract: they have no resource package to own their identity.
func catalogOnlyKeys() map[string]bool {
	return map[string]bool{
		resourceKey("", "v1", "Endpoints"):                      true,
		resourceKey("storage.k8s.io", "v1", "CSIDriver"):        true,
		resourceKey("storage.k8s.io", "v1", "CSINode"):          true,
		resourceKey("storage.k8s.io", "v1", "VolumeAttachment"): true,
		resourceKey("coordination.k8s.io", "v1", "Lease"):       true,
	}
}

// TestEveryPackagedKindIsSourcedFromItsPackage proves the forward direction: each
// kind package's declared identity appears in the contract, exactly as the
// package declares it. A forgotten wiring or a drifting literal copy fails here.
func TestEveryPackagedKindIsSourcedFromItsPackage(t *testing.T) {
	for _, id := range packagedKindIdentities() {
		got, ok := FindBuiltin(id.Group, id.Version, id.Kind)
		require.Truef(t, ok, "packaged kind %s/%s/%s missing from the contract", id.Group, id.Version, id.Kind)
		require.Equalf(t, fromIdentity(id), got, "contract row for %s drifted from its package identity", id.Kind)
	}
}

// TestOnlyCatalogOnlyKindsAreDeclaredInline proves the reverse direction: every
// contract row is either sourced from a package identity or is one of the
// explicitly allowed catalog-only kinds. A new hand-written literal for a kind
// that should be package-owned fails here.
func TestOnlyCatalogOnlyKindsAreDeclaredInline(t *testing.T) {
	packaged := make(map[string]bool)
	for _, id := range packagedKindIdentities() {
		packaged[resourceKey(id.Group, id.Version, id.Kind)] = true
	}
	catalogOnly := catalogOnlyKeys()

	for _, resource := range BuiltinResources {
		key := resourceKey(resource.Group, resource.Version, resource.Kind)
		if packaged[key] || catalogOnly[key] {
			continue
		}
		t.Errorf("contract row %s is neither package-sourced nor an allowed catalog-only kind", key)
	}

	require.Equalf(t, len(BuiltinResources), len(packagedKindIdentities())+len(catalogOnly),
		"contract has %d rows but the test accounts for %d packaged + %d catalog-only",
		len(BuiltinResources), len(packagedKindIdentities()), len(catalogOnly))
}
