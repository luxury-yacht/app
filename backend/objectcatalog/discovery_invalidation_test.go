package objectcatalog

import (
	"context"
	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/informers"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/tools/cache"
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

// TestCRDWatchHandlerMarksDiscoveryStale proves the wiring: a CRD add/update/delete event
// on the apiext informer marks discovery stale (so the next discover invalidates) and still
// delegates to the base handler.
func TestCRDWatchHandlerMarksDiscoveryStale(t *testing.T) {
	svc := &Service{clusterID: "c1"}
	baseCalls := 0
	base := cache.ResourceEventHandlerFuncs{
		AddFunc:    func(interface{}) { baseCalls++ },
		UpdateFunc: func(interface{}, interface{}) { baseCalls++ },
		DeleteFunc: func(interface{}) { baseCalls++ },
	}
	h := newWatchNotifier(svc).crdWatchHandler(base)

	require.False(t, svc.discoveryStale.Load())
	h.AddFunc(nil)
	require.True(t, svc.discoveryStale.Load(), "a CRD add marks discovery stale")
	require.Equal(t, 1, baseCalls, "the base handler still runs")

	svc.discoveryStale.Store(false)
	h.DeleteFunc(nil)
	require.True(t, svc.discoveryStale.Load(), "a CRD delete marks discovery stale")
	require.Equal(t, 2, baseCalls)
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
		{"new incarnation", func(c *apiextensionsv1.CustomResourceDefinition) { c.UID = "replacement" }, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			old := &apiextensionsv1.CustomResourceDefinition{
				ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "definition", ResourceVersion: "1"},
				Spec:       apiextensionsv1.CustomResourceDefinitionSpec{Group: "example.com", Scope: apiextensionsv1.NamespaceScoped, Names: apiextensionsv1.CustomResourceDefinitionNames{Kind: "Widget", Plural: "widgets"}, Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}}},
				Status:     apiextensionsv1.CustomResourceDefinitionStatus{Conditions: []apiextensionsv1.CustomResourceDefinitionCondition{{Type: apiextensionsv1.Established, Status: apiextensionsv1.ConditionTrue}}},
			}
			next := old.DeepCopy()
			next.ResourceVersion = "2"
			test.change(next)
			svc := newTestWatchService()
			notifier := newWatchNotifier(svc)
			updates := 0
			handler := notifier.crdWatchHandler(cache.ResourceEventHandlerFuncs{UpdateFunc: func(_, _ interface{}) { updates++ }})
			handler.UpdateFunc(old, next)
			require.Equal(t, test.want, svc.discoveryStale.Load())
			require.Equal(t, test.want, len(notifier.resyncRequested) > 0, "only API-surface changes should request a full collection")
			require.Equal(t, 1, updates, "every update still reaches the CRD table")
		})
	}
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
	api := apiextfake.NewClientset()
	extensions := apiextinformers.NewSharedInformerFactory(api, time.Minute)
	definitions := extensions.Apiextensions().V1().CustomResourceDefinitions().Informer()
	extensions.Start(ctx.Done())
	require.True(t, cache.WaitForCacheSync(ctx.Done(), definitions.HasSynced))
	discovery := &stubDiscovery{DiscoveryInterface: kube.Discovery()}
	svc := NewService(Dependencies{
		Common:    common.Dependencies{KubernetesClient: kube, DynamicClient: widgetDynamicClient(widgetObject("default", "newly-discovered", "1"))},
		ClusterID: "c1", InformerFactory: informers.NewSharedInformerFactory(kube, time.Minute), APIExtensionsInformerFactory: extensions,
	}, nil)
	svc.discoveryClient = discovery
	done := make(chan error, 1)
	go func() { done <- svc.Run(ctx) }()
	t.Cleanup(func() { cancel(); <-done; extensions.Shutdown() })
	require.Eventually(t, func() bool { return svc.Health().Status == HealthStateOK && svc.Query(QueryOptions{}).TotalItems == 0 }, time.Second, time.Millisecond)
	discovery.lists = []*metav1.APIResourceList{{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: []string{"list", "watch"}}}}}
	_, err := api.ApiextensionsV1().CustomResourceDefinitions().Create(ctx, &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "new-definition"},
		Status:     apiextensionsv1.CustomResourceDefinitionStatus{Conditions: []apiextensionsv1.CustomResourceDefinitionCondition{{Type: apiextensionsv1.Established, Status: apiextensionsv1.ConditionTrue}}},
		Spec:       apiextensionsv1.CustomResourceDefinitionSpec{Group: "example.com", Scope: apiextensionsv1.NamespaceScoped, Names: apiextensionsv1.CustomResourceDefinitionNames{Kind: "Widget", Plural: "widgets"}, Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == 1 }, time.Second, time.Millisecond, "CRD arrival must refresh discovery while the healthy stream suppresses polling")
}

func TestCRDAddWaitsForEstablishmentBeforeRecollection(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "c1"}, nil)
	notifier := newWatchNotifier(svc)
	handler := notifier.crdWatchHandler(cache.ResourceEventHandlerFuncs{})
	crd := &apiextensionsv1.CustomResourceDefinition{ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "widget-definition"}}
	handler.OnAdd(crd, false)
	_, requested := notifier.takeFullSyncRequest()
	require.False(t, requested, "an API not yet established must not trigger a wasted collection")
	established := crd.DeepCopy()
	established.Status.Conditions = []apiextensionsv1.CustomResourceDefinitionCondition{{Type: apiextensionsv1.Established, Status: apiextensionsv1.ConditionTrue}}
	handler.OnUpdate(crd, established)
	_, requested = notifier.takeFullSyncRequest()
	require.True(t, requested, "establishment must trigger collection without waiting for the periodic refresh")
}
