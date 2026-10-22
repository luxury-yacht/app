package objectcatalog

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
)

// stubDiscovery is a minimal DiscoveryInterface returning a fixed resource list, so the
// catalog's discover path can be exercised without a real apiserver. Only the methods the
// discover path calls are implemented; the rest are nil (never invoked here).
type stubDiscovery struct {
	discovery.DiscoveryInterface
	lists []*metav1.APIResourceList
}

func (s *stubDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return s.lists, nil
}

func podOnlyResourceLists() []*metav1.APIResourceList {
	return []*metav1.APIResourceList{{
		GroupVersion: "v1",
		APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod", Namespaced: true, Verbs: []string{"list"}}},
	}}
}

// TestCatalogDiscoveryInvalidatesAfterCRDChange pins the disk-cache invalidation contract:
// a periodic discover serves from the cache (no Invalidate), but once a CRD change has
// marked discovery stale the next discover Invalidate()s the cache exactly once, so a
// newly-created CRD is never hidden behind a stale discovery document.
func TestCatalogDiscoveryInvalidatesAfterCRDChange(t *testing.T) {
	invalidations := 0
	svc := &Service{clusterID: "c1"}
	svc.discoveryClient = &stubDiscovery{lists: podOnlyResourceLists()}
	svc.discoveryInvalidate = func() { invalidations++ }

	ctx := context.Background()

	// Periodic discover, no CRD change → no invalidation (the cache is reused).
	descs, err := svc.discoverResources(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, descs)
	require.Equal(t, 0, invalidations)

	// A CRD change marks discovery stale → the next discover invalidates once.
	svc.markDiscoveryStale()
	_, err = svc.discoverResources(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, invalidations)

	// No further CRD change → no extra invalidation.
	_, err = svc.discoverResources(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, invalidations)

	// Another CRD change → invalidates again.
	svc.markDiscoveryStale()
	_, err = svc.discoverResources(ctx)
	require.NoError(t, err)
	require.Equal(t, 2, invalidations)
}

// crdBundle is the CRD's ingest bundle half the discovery hook reads, as the
// CRD reflector projects it.
func crdBundle(crd *apiextensionsv1.CustomResourceDefinition) ingest.Bundle {
	return ingest.Bundle{Aggregate: apiextensions.StreamDescriptor.AggregateRow(crd)}
}

func establishedWidgetDefinition() *apiextensionsv1.CustomResourceDefinition {
	return &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "definition", ResourceVersion: "1"},
		Spec:       apiextensionsv1.CustomResourceDefinitionSpec{Group: "example.com", Scope: apiextensionsv1.NamespaceScoped, Names: apiextensionsv1.CustomResourceDefinitionNames{Kind: "Widget", Plural: "widgets"}, Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}}},
		Status:     apiextensionsv1.CustomResourceDefinitionStatus{Conditions: []apiextensionsv1.CustomResourceDefinitionCondition{{Type: apiextensionsv1.Established, Status: apiextensionsv1.ConditionTrue}}},
	}
}

// A CRD that appears or goes away marks discovery stale, so the next discover
// invalidates the cached discovery document.
func TestCRDDiscoveryHookMarksDiscoveryStale(t *testing.T) {
	svc := newTestWatchService()
	hook := newCRDDiscoveryHook(newWatchNotifier(svc))
	crd := establishedWidgetDefinition()

	hook.UpsertBundle(crdBundle(crd))
	require.True(t, svc.discoveryStale.Load(), "a new CRD marks discovery stale")

	svc.discoveryStale.Store(false)
	hook.DeleteBundle(crdBundle(crd))
	require.True(t, svc.discoveryStale.Load(), "a deleted CRD marks discovery stale")
}

func TestCRDUpdatesRecollectOnlyWhenDiscoveryChanges(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*apiextensionsv1.CustomResourceDefinition)
		want   bool
	}{
		{"resource version", func(*apiextensionsv1.CustomResourceDefinition) {}, false},
		{"status reason", func(c *apiextensionsv1.CustomResourceDefinition) { c.Status.Conditions[0].Reason = "Reconciled" }, false},
		{"labels", func(c *apiextensionsv1.CustomResourceDefinition) { c.Labels = map[string]string{"operator": "updated"} }, false},
		{"schema", func(c *apiextensionsv1.CustomResourceDefinition) {
			c.Spec.Versions[0].Schema = &apiextensionsv1.CustomResourceValidation{OpenAPIV3Schema: &apiextensionsv1.JSONSchemaProps{Type: "object"}}
		}, false},
		{"unserved version", func(c *apiextensionsv1.CustomResourceDefinition) {
			c.Spec.Versions = append(c.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2"})
		}, false},
		{"served version", func(c *apiextensionsv1.CustomResourceDefinition) {
			c.Spec.Versions = append(c.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true})
		}, true},
		{"scope", func(c *apiextensionsv1.CustomResourceDefinition) { c.Spec.Scope = apiextensionsv1.ClusterScoped }, true},
		{"names", func(c *apiextensionsv1.CustomResourceDefinition) { c.Spec.Names.Kind = "Replacement" }, true},
		{"accepted names", func(c *apiextensionsv1.CustomResourceDefinition) { c.Status.AcceptedNames = c.Spec.Names }, true},
		{"API establishment", func(c *apiextensionsv1.CustomResourceDefinition) {
			c.Status.Conditions[0].Status = apiextensionsv1.ConditionFalse
		}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			old := establishedWidgetDefinition()
			next := old.DeepCopy()
			next.ResourceVersion = "2"
			test.change(next)
			svc := newTestWatchService()
			notifier := newWatchNotifier(svc)
			hook := newCRDDiscoveryHook(notifier)
			hook.UpsertBundle(crdBundle(old))
			svc.discoveryStale.Store(false)
			notifier.takeFullSyncRequest()

			hook.UpsertBundle(crdBundle(next))
			require.Equal(t, test.want, svc.discoveryStale.Load())
			requested := notifier.takeFullSyncRequest()
			require.Equal(t, test.want, requested, "only API-surface changes should request a full collection")
		})
	}
}

// A relist sends the CRD set with no per-CRD deletes. A CRD it omits, or one
// whose API changed, marks discovery stale and requests one full collection;
// an unchanged relist requests none.
func TestCRDRelistRecollectsOnlyForVanishedOrChangedDefinitions(t *testing.T) {
	svc := newTestWatchService()
	notifier := newWatchNotifier(svc)
	hook := newCRDDiscoveryHook(notifier)
	widgets := establishedWidgetDefinition()
	gadgets := establishedWidgetDefinition()
	gadgets.Name, gadgets.UID, gadgets.Spec.Names = "gadgets.example.com", "gadget-definition", apiextensionsv1.CustomResourceDefinitionNames{Kind: "Gadget", Plural: "gadgets"}
	hook.ReplaceBundles([]ingest.Bundle{crdBundle(widgets), crdBundle(gadgets)})
	svc.discoveryStale.Store(false)
	notifier.takeFullSyncRequest()

	hook.ReplaceBundles([]ingest.Bundle{crdBundle(widgets), crdBundle(gadgets)})
	requested := notifier.takeFullSyncRequest()
	require.False(t, requested, "an unchanged relist must not recollect")
	require.False(t, svc.discoveryStale.Load())

	hook.ReplaceBundles([]ingest.Bundle{crdBundle(widgets)})
	requested = notifier.takeFullSyncRequest()
	require.True(t, requested, "a CRD the relist omits must recollect")
	require.True(t, svc.discoveryStale.Load())
}

func TestNewCRDAppearsWithoutWaitingForPeriodicCatalogRefresh(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	kube := kubefake.NewClientset()
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status.Allowed = true
		return true, review, nil
	})
	server := ingesttest.NewAPIServer(t)
	definitions := ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "c1"}, server.Client(t), server.APIExtensionsClient(t), nil)
	definitions.Start(ctx)
	t.Cleanup(definitions.Stop)
	require.Eventually(t, definitions.HasSynced, 5*time.Second, time.Millisecond)
	discovery := &stubDiscovery{DiscoveryInterface: kube.Discovery()}
	svc := NewService(Dependencies{
		Common:    common.Dependencies{KubernetesClient: kube, DynamicClient: widgetDynamicClient(widgetObject("default", "newly-discovered", "1"))},
		ClusterID: "c1", IngestSource: definitions,
	}, nil)
	svc.discoveryClient = discovery
	done := make(chan error, 1)
	go func() { done <- svc.Run(ctx) }()
	t.Cleanup(func() { cancel(); <-done })
	require.Eventually(t, func() bool { return svc.Health().Status == HealthStateOK && svc.Query(QueryOptions{}).TotalItems == 0 }, time.Second, time.Millisecond)
	discovery.lists = []*metav1.APIResourceList{{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: []string{"list", "watch"}}}}}
	server.Create(t, establishedWidgetDefinition())
	require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == 1 }, 2*time.Second, time.Millisecond, "CRD arrival must refresh discovery while the healthy stream suppresses polling")
}

// An added CRD whose API is not yet established requests no collection; the
// later status-only Established transition requests one.
func TestCRDAddWaitsForEstablishmentBeforeRecollection(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "c1"}, nil)
	notifier := newWatchNotifier(svc)
	hook := newCRDDiscoveryHook(notifier)
	crd := establishedWidgetDefinition()
	crd.Status.Conditions = nil
	hook.UpsertBundle(crdBundle(crd))
	requested := notifier.takeFullSyncRequest()
	require.False(t, requested, "an API not yet established must not trigger a wasted collection")
	established := crd.DeepCopy()
	established.ResourceVersion = "2"
	established.Status.Conditions = []apiextensionsv1.CustomResourceDefinitionCondition{{Type: apiextensionsv1.Established, Status: apiextensionsv1.ConditionTrue}}
	hook.UpsertBundle(crdBundle(established))
	requested = notifier.takeFullSyncRequest()
	require.True(t, requested, "establishment must trigger collection without waiting for the periodic refresh")
}
