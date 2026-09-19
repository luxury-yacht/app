package backend

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// Exercise the production composition, replacing only Kubernetes API clients.
// A custom-domain signal alone cannot satisfy a catalog-backed table query.
func TestCatalogCustomResourceWatchReconcilesTableMembership(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	app, target := catalogLifecycleTestApp(t, system.TierForeground, false)
	clients := app.ClusterRuntime.clusterClientsForID(target.meta.ID)
	kube := clients.client.(*kubefake.Clientset)
	allowSelfSubjectAccessReviews(kube)
	gvr := schema.GroupVersionResource{Group: "external-secrets.io", Version: "v1", Resource: "externalsecrets"}
	kube.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{
		GroupVersion: gvr.GroupVersion().String(),
		APIResources: []metav1.APIResource{{Name: gvr.Resource, Kind: "ExternalSecret", Namespaced: true, Verbs: []string{"list", "watch"}}},
	}}
	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(gvr.GroupVersion().WithKind("ExternalSecret"))
	resource.SetNamespace("argocd")
	resource.SetName("argocd-saml")
	resource.SetUID("secret-uid")
	resource.SetResourceVersion("1")
	other := resource.DeepCopy()
	other.SetNamespace("other")
	other.SetUID("other-uid")
	dynamic := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "ExternalSecretList"}, resource, other)
	clients.dynamicClient = dynamic
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	_, err := clients.apiextensionsClient.ApiextensionsV1().CustomResourceDefinitions().Create(ctx, &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "externalsecrets.external-secrets.io"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: gvr.Group, Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: gvr.Resource, Kind: "ExternalSecret"},
			Scope:    apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: gvr.Version, Served: true, Storage: true}},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	subsystem := app.Refresh.getRefreshSubsystem(target.meta.ID)
	subsystem.ResourceStream = resourcestream.NewManager(subsystem.InformerFactory, nil, nil, snapshot.ClusterMeta{ClusterID: target.meta.ID}, dynamic, subsystem.IngestManager)
	t.Cleanup(subsystem.ResourceStream.Stop)
	require.NoError(t, subsystem.InformerFactory.Start(ctx))
	selector, err := resourcestream.ParseStreamSelector(target.meta.ID, "catalog", "")
	require.NoError(t, err)
	sub, err := subsystem.ResourceStream.SubscribeSelector(selector)
	require.NoError(t, err)
	defer sub.Cancel()
	require.NoError(t, app.Refresh.startObjectCatalogForTarget(target))
	service := app.Refresh.objectCatalogServiceForCluster(target.meta.ID)
	query := objectcatalog.QueryOptions{Namespaces: []string{"argocd"}}
	require.Eventually(t, func() bool { return len(service.Query(query).Items) == 1 }, 3*time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool {
		for _, action := range dynamic.Actions() {
			if action.GetVerb() == "watch" && action.GetResource() == gvr {
				return true
			}
		}
		return false
	}, time.Second, 10*time.Millisecond)
	// Wait for initialization signals before exercising a mutation.
	for len(sub.Updates) > 0 {
		<-sub.Updates
	}
	updated := resource.DeepCopy()
	updated.SetResourceVersion("2")
	updated.SetFinalizers([]string{"external-secrets.io/cleanup"})
	deleting := metav1.Now()
	updated.SetDeletionTimestamp(&deleting)
	_, err = dynamic.Resource(gvr).Namespace("argocd").Update(ctx, updated, metav1.UpdateOptions{})
	require.NoError(t, err)
	requireCatalogSignalState(t, sub, func() bool {
		rows := service.Query(query).Items
		return len(rows) == 1 && rows[0].ResourceVersion == "2" && len(service.FinalizerBlockers()) == 1
	})
	require.NoError(t, dynamic.Resource(gvr).Namespace("argocd").Delete(ctx, resource.GetName(), metav1.DeleteOptions{}))
	requireCatalogSignalState(t, sub, func() bool {
		return len(service.Query(query).Items) == 0 && len(service.FinalizerBlockers()) == 0
	})
	remaining := service.Query(objectcatalog.QueryOptions{}).Items
	require.Len(t, remaining, 1)
	require.Equal(t, "other", remaining[0].Ref.Namespace)
	require.Equal(t, target.meta.ID, remaining[0].Ref.ClusterID)

	// Restart the catalog against the same live producer. Delete an object after
	// its initial LIST has captured it, before that LIST returns to the catalog.
	// Waiting for the custom-domain event makes this startup race deterministic.
	app.Refresh.stopObjectCatalogForCluster(target.meta.ID)
	recreated := resource.DeepCopy()
	recreated.SetUID("recreated-uid")
	_, err = dynamic.Resource(gvr).Namespace("argocd").Create(ctx, recreated, metav1.CreateOptions{})
	require.NoError(t, err)
	ref := remaining[0].Ref
	ref.Namespace = "argocd"
	require.Eventually(t, func() bool {
		object, ready := subsystem.ResourceStream.WatchedCustomResource(ref)
		return ready && object != nil && object.GetUID() == recreated.GetUID()
	}, time.Second, time.Millisecond)
	customSelector, err := resourcestream.ParseStreamSelector(target.meta.ID, "namespace-custom", "namespace:argocd")
	require.NoError(t, err)
	customSub, err := subsystem.ResourceStream.SubscribeSelector(customSelector)
	require.NoError(t, err)
	defer customSub.Cancel()
	whileListing := true
	dynamic.PrependReactor("list", gvr.Resource, func(action clienttesting.Action) (bool, runtime.Object, error) {
		if !whileListing {
			return false, nil, nil
		}
		whileListing = false
		staleList, listErr := dynamic.Tracker().List(gvr, resource.GroupVersionKind(), action.GetNamespace())
		if listErr != nil {
			return true, nil, listErr
		}
		if deleteErr := dynamic.Tracker().Delete(gvr, "argocd", resource.GetName()); deleteErr != nil {
			return true, nil, deleteErr
		}
		select {
		case <-customSub.Updates:
			return true, staleList, nil
		case <-time.After(time.Second):
			return true, nil, fmt.Errorf("custom watch failed to deliver deletion during catalog startup")
		}
	})
	for len(sub.Updates) > 0 {
		<-sub.Updates
	}
	require.NoError(t, app.Refresh.startObjectCatalogForTarget(target))
	replacement := app.Refresh.objectCatalogServiceForCluster(target.meta.ID)
	requireCatalogSignalState(t, sub, func() bool {
		return replacement.Health().Status == objectcatalog.HealthStateOK && replacement.Query(query).TotalItems == 0 && replacement.Query(objectcatalog.QueryOptions{}).TotalItems == 1
	})
}

func requireCatalogSignalState(t *testing.T, sub *resourcestream.Subscription, current func() bool) {
	t.Helper()
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	for {
		select {
		case update := <-sub.Updates:
			require.Equal(t, "catalog", update.Domain)
			if current() {
				return
			}
		case <-timer.C:
			t.Fatal("catalog signal did not expose the changed table membership before the periodic resync")
		}
	}
}
