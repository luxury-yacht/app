package objectcatalog

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
)

func TestFindExactMatchReturnsCanonicalItem(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	namespacedDesc := Descriptor{

		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
	clusterDesc := Descriptor{

		Namespaced: false,
		Kind:       "CustomResourceDefinition",
		Group:      "apiextensions.k8s.io",
		Version:    "v1",
		Resource:   "customresourcedefinitions",
		Scope:      ScopeCluster,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(namespacedDesc, "apps", "demo"):         {Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "apps", Name: "demo", UID: "deploy-uid"}, Scope: ScopeNamespace},
		catalogKey(clusterDesc, "", "widgets.example.com"): {Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition", Resource: "customresourcedefinitions", Name: "widgets.example.com", UID: "crd-uid"}, Scope: ScopeCluster},
	}
	svc.mu.Unlock()

	match, ok := svc.FindExactMatch("apps", "apps", "v1", "Deployment", "demo")
	if !ok {
		t.Fatal("expected namespaced item match")
	}
	if match.Ref.UID != "deploy-uid" {
		t.Fatalf("expected deployment uid, got %q", match.Ref.UID)
	}

	clusterMatch, ok := svc.FindExactMatch("__cluster__", "apiextensions.k8s.io", "v1", "CustomResourceDefinition", "widgets.example.com")
	if !ok {
		t.Fatal("expected cluster-scoped item match")
	}
	if clusterMatch.Ref.UID != "crd-uid" {
		t.Fatalf("expected crd uid, got %q", clusterMatch.Ref.UID)
	}
}

func TestFindExactMatchRejectsPartialMatches(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	desc := Descriptor{

		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(desc, "apps", "alpha"): {Ref: resourcemodel.ResourceRef{Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "apps", Name: "alpha", UID: "alpha-uid"}, Scope: ScopeNamespace},
	}
	svc.mu.Unlock()

	if _, ok := svc.FindExactMatch("apps", "apps", "v1", "Deployment", "alp"); ok {
		t.Fatal("unexpected exact match for partial name")
	}
	if _, ok := svc.FindExactMatch("apps", "apps", "v1", "StatefulSet", "alpha"); ok {
		t.Fatal("unexpected exact match for different kind")
	}
	if _, ok := svc.FindExactMatch("apps", "apps", "", "Deployment", "alpha"); ok {
		t.Fatal("unexpected exact match when version is missing")
	}
}

func TestResolveResourceForGVKUsesCatalogDescriptors(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	desc := Descriptor{

		Namespaced: true,
		Kind:       "Widget",
		Group:      "example.com",
		Version:    "v1alpha1",
		Resource:   "widgets",
		Scope:      ScopeNamespace,
	}
	svc.identity.replaceDiscovered([]Descriptor{desc})

	resolved, ok, err := svc.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1alpha1",
		Kind:    "Widget",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected descriptor match")
	}
	if resolved.Resource != "widgets" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}

	if _, ok, err := svc.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "other.example.com",
		Version: "v1alpha1",
		Kind:    "Widget",
	}); err != nil || ok {
		t.Fatalf("expected no match for wrong group, ok=%v err=%v", ok, err)
	}
}

func TestResolveResourceForGVKUsesBuiltinIdentityBeforeSync(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	resolved, ok, err := svc.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "apps",
		Version: "v1",
		Kind:    "Deployment",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected built-in identity match")
	}
	if resolved.Resource != "deployments" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}
}

func TestResourceResolverHydratesFromDiscoveryOnMiss(t *testing.T) {
	client := fake.NewClientset()
	discoveryClient, ok := client.Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatalf("expected fake discovery client, got %T", client.Discovery())
	}
	discoveryClient.Resources = []*metav1.APIResourceList{{
		GroupVersion: "example.com/v1",
		APIResources: []metav1.APIResource{{
			Name:       "widgets",
			Kind:       "Widget",
			Namespaced: true,
			Verbs:      metav1.Verbs{"list"},
		}},
	}}

	resolver := NewResourceResolver(common.Dependencies{KubernetesClient: client}, nil)
	resolved, ok, err := resolver.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected discovery-hydrated identity match")
	}
	if resolved.Resource != "widgets" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}
}

type failingPreferredDiscovery struct {
	*fakediscovery.FakeDiscovery
	err error
}

func (f *failingPreferredDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return nil, f.err
}

func TestResourceResolverFallsBackToCRDWhenDiscoveryFails(t *testing.T) {
	baseClient := fake.NewClientset()
	discoveryClient, ok := baseClient.Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatalf("expected fake discovery client, got %T", baseClient.Discovery())
	}
	client := &discoveryOverrideClient{
		Clientset: baseClient,
		discovery: &failingPreferredDiscovery{
			FakeDiscovery: discoveryClient,
			err:           errors.New("preferred discovery unavailable"),
		},
	}
	apiExtensionsClient := apiextensionsfake.NewClientset(&apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "widgets",
				Kind:   "Widget",
			},
			Scope: apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	})

	resolver := NewResourceResolver(common.Dependencies{
		KubernetesClient:    client,
		APIExtensionsClient: apiExtensionsClient,
	}, nil)
	resolved, ok, err := resolver.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected CRD fallback identity match")
	}
	if resolved.Resource != "widgets" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}
}

var lookupCertificates = Descriptor{
	Group: "cert-manager.io", Version: "v1", Kind: "Certificate",
	Resource: "certificates", Namespaced: true, Scope: ScopeNamespace,
}

func lookupCertificate(name, uid string) Summary {
	return Summary{Ref: resourcemodel.ResourceRef{
		ClusterID: "cluster-a", Group: "cert-manager.io", Version: "v1", Kind: "Certificate",
		Resource: "certificates", Namespace: "apps", Name: name, UID: uid,
	}, Scope: ScopeNamespace}
}

// lookupSync is one catalog sync's collection results, ready to publish.
func lookupSync(svc *Service, succeeded map[Descriptor][]Summary, failed ...Descriptor) *catalogSync {
	run := &catalogSync{
		service: svc, aggregator: newStreamingAggregator(svc),
		newItems: map[string]Summary{}, newLastSeen: map[string]time.Time{},
		succeeded: map[string][]Summary{}, failed: map[string]error{}, allowedSet: map[string]Descriptor{},
	}
	for desc, summaries := range succeeded {
		run.allowedSet[desc.GVR().String()] = desc
		run.succeeded[desc.GVR().String()] = summaries
		for _, summary := range summaries {
			run.newItems[catalogKey(desc, summary.Ref.Namespace, summary.Ref.Name)] = summary
		}
	}
	for _, desc := range failed {
		run.allowedSet[desc.GVR().String()] = desc
		run.failed[desc.GVR().String()] = errors.New("list timed out")
	}
	return run
}

// A Helm manifest can name an object by any version the cluster serves, while
// the catalog stores each resource under one. LookupObject finds the object
// whatever version was asked for, and calls a miss absent only in a resource
// the published sync listed completely.
func TestLookupObjectMatchesAnyServedVersionAndVouchesForAbsence(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	// Before any publication, a miss proves nothing.
	if early := svc.LookupObject("apps", "cert-manager.io", "Certificate", "api-tls"); early.Found || early.Absent {
		t.Fatalf("a miss before the catalog has published must not be absent, got %+v", early)
	}

	lookupSync(svc, map[Descriptor][]Summary{lookupCertificates: {lookupCertificate("web-tls", "cert-uid")}}).
		publish([]Descriptor{lookupCertificates}, nil)

	found := svc.LookupObject("apps", "cert-manager.io", "Certificate", "web-tls")
	if !found.Found || found.Summary.Ref.UID != "cert-uid" {
		t.Fatalf("expected the stored certificate, got %+v", found)
	}
	if absent := svc.LookupObject("apps", "cert-manager.io", "Certificate", "api-tls"); absent.Found || !absent.Absent {
		t.Fatalf("a miss in a completely listed resource must be absent, got %+v", absent)
	}
	// A kind the catalog has not listed is never absent.
	if unlisted := svc.LookupObject("apps", "example.com", "Widget", "w"); unlisted.Found || unlisted.Absent {
		t.Fatalf("an unlisted kind must not be absent, got %+v", unlisted)
	}
}

// A sync publishes its rows, keeping a failed resource's previous rows, before
// it records completion and marks health stale. Absence must come from that
// one publication: right after it, a resource whose list failed or was
// forbidden is never vouched for, while a completely listed one is.
func TestLookupObjectJudgesAbsenceFromThePublishedSyncAlone(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	issuers := Descriptor{
		Group: "cert-manager.io", Version: "v1", Kind: "Issuer",
		Resource: "issuers", Namespaced: true, Scope: ScopeNamespace,
	}
	secrets := Descriptor{Version: "v1", Kind: "Secret", Resource: "secrets", Namespaced: true, Scope: ScopeNamespace}
	run := lookupSync(svc, map[Descriptor][]Summary{issuers: nil, secrets: nil}, lookupCertificates)
	svc.recordDeniedResource("secrets")

	// recordCompletion has not run, so catalog health is not stale yet.
	run.publish([]Descriptor{lookupCertificates, issuers, secrets}, errors.New("one descriptor failed"))

	if failed := svc.LookupObject("apps", "cert-manager.io", "Certificate", "web-tls"); failed.Absent {
		t.Fatalf("a resource whose list failed must not be absent, got %+v", failed)
	}
	if listed := svc.LookupObject("apps", "cert-manager.io", "Issuer", "letsencrypt"); !listed.Absent {
		t.Fatalf("a completely listed resource must vouch for absence, got %+v", listed)
	}
	denied := svc.LookupObject("apps", "", "Secret", "tls")
	if denied.Absent || denied.Denied != "secrets" {
		t.Fatalf("a forbidden resource must report the denial instead of absence, got %+v", denied)
	}

	// The next sync clears the denial set before it lists again; the published
	// answer stays the previous sync's until that sync publishes.
	svc.resetDeniedResources()
	if stillDenied := svc.LookupObject("apps", "", "Secret", "tls"); stillDenied.Absent || stillDenied.Denied != "secrets" {
		t.Fatalf("a denial must last until the next publication, got %+v", stillDenied)
	}
}
