package objectcatalog

import (
	"sort"
	"testing"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
)

// The object catalog is the source of truth for namespace/cluster listings, so a
// kind silently dropping out of its informer-backed list path makes it vanish from
// browse/catalog views. The catalog derives which kinds each informer factory
// serves from kindregistry.All by CatalogSource facet (informer_registry.go), so
// these guards pin each source's kind set to a golden list — a changed or dropped
// CatalogSource facet, or a new kind, fails loudly. The four collection sources
// plus CatalogNone partition every kind (CatalogDynamic is the zero value), so
// adding any kind also breaks one of these sets. Literal kind names in tests are sanctioned by the
// resource-kind-registry contract (docs/architecture/resource-kind-registry.md).

func catalogSourceKinds(source kindspec.CatalogSource) []string {
	var out []string
	for _, d := range kindregistry.All {
		if d.CatalogSource == source {
			out = append(out, d.Identity.Kind)
		}
	}
	return out
}

func assertCatalogKindSet(t *testing.T, name string, want, got []string) {
	t.Helper()
	wantSet := map[string]bool{}
	for _, k := range want {
		wantSet[k] = true
	}
	gotSet := map[string]bool{}
	for _, k := range got {
		gotSet[k] = true
	}
	var missing, extra []string
	for k := range wantSet {
		if !gotSet[k] {
			missing = append(missing, k)
		}
	}
	for k := range gotSet {
		if !wantSet[k] {
			extra = append(extra, k)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) > 0 {
		t.Errorf("%s: %v expected but no longer have this catalog source (kind dropped from this list path)", name, missing)
	}
	if len(extra) > 0 {
		t.Errorf("%s: %v have this catalog source but are not in the expected set (update this guard deliberately)", name, extra)
	}
}

func TestCatalogSharedSourceKindsDoNotDrift(t *testing.T) {
	assertCatalogKindSet(t, "catalog shared-informer source", []string{
		"ClusterRole", "ClusterRoleBinding", "ConfigMap", "CronJob", "DaemonSet",
		"Deployment", "EndpointSlice", "HorizontalPodAutoscaler", "Ingress", "Job",
		"LimitRange", "Namespace", "NetworkPolicy", "Node", "PersistentVolume",
		"PersistentVolumeClaim", "Pod", "ReplicaSet", "ResourceQuota", "Role",
		"RoleBinding", "Secret", "Service", "StatefulSet", "StorageClass",
	}, catalogSourceKinds(kindspec.CatalogShared))
}

func TestCatalogGatewaySourceKindsDoNotDrift(t *testing.T) {
	assertCatalogKindSet(t, "catalog gateway-informer source", []string{
		"BackendTLSPolicy", "GRPCRoute", "Gateway", "GatewayClass", "HTTPRoute",
		"ListenerSet", "ReferenceGrant", "TLSRoute",
	}, catalogSourceKinds(kindspec.CatalogGateway))
}

func TestCatalogAPIExtensionsSourceKindsDoNotDrift(t *testing.T) {
	assertCatalogKindSet(t, "catalog apiextensions source",
		[]string{"CustomResourceDefinition"},
		catalogSourceKinds(kindspec.CatalogAPIExtensions))
}

func TestCatalogDynamicSourceKindsDoNotDrift(t *testing.T) {
	assertCatalogKindSet(t, "catalog dynamic source", []string{
		"IngressClass", "MutatingWebhookConfiguration", "PodDisruptionBudget",
		"ServiceAccount", "ValidatingWebhookConfiguration",
	}, catalogSourceKinds(kindspec.CatalogDynamic))
}

func TestCatalogExcludedKindsDoNotDrift(t *testing.T) {
	assertCatalogKindSet(t, "non-catalog kinds", []string{"Event"}, catalogSourceKinds(kindspec.CatalogNone))
}

// TestCatalogSharedInformerResourcesResolve proves every GVR the catalog declares
// as shared-informer-backed actually resolves to an informer lister via the
// factory's ForResource. A wrong resource name would make sharedInformerLister
// return nil and the kind would silently fall back off the informer path.
func TestCatalogSharedInformerResourcesResolve(t *testing.T) {
	factory := informers.NewSharedInformerFactory(fake.NewClientset(), 0)
	for gr, gvr := range sharedInformerGroupResources {
		if sharedInformerLister(factory, gvr) == nil {
			t.Errorf("shared catalog resource %s (%s) does not resolve to an informer lister", gr.String(), gvr.String())
		}
	}
}

// TestCatalogGatewayInformerResourcesResolve is the Gateway-API equivalent.
func TestCatalogGatewayInformerResourcesResolve(t *testing.T) {
	factory := gatewayinformers.NewSharedInformerFactory(gatewayfake.NewClientset(), 0)
	for gr, gvr := range gatewayInformerGroupResources {
		if gatewayInformerLister(factory, gvr) == nil {
			t.Errorf("gateway catalog resource %s (%s) does not resolve to an informer lister", gr.String(), gvr.String())
		}
	}
}
