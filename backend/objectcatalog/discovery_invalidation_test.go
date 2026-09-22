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
		Spec:       apiextensionsv1.CustomResourceDefinitionSpec{Group: "example.com", Scope: apiextensionsv1.NamespaceScoped, Names: apiextensionsv1.CustomResourceDefinitionNames{Kind: "Widget", Plural: "widgets"}, Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == 1 }, time.Second, time.Millisecond, "CRD arrival must refresh discovery while the healthy stream suppresses polling")
}
