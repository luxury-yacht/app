package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// Replace only Kubernetes clients: subsystem construction, ingest, catalog,
// response invalidation and the outbound catalog doorbell are the production path.
func TestCatalogCustomResourceWatchReconcilesTableMembership(t *testing.T) {
	for _, version := range []string{"v1", "v1beta1"} {
		t.Run(version, func(t *testing.T) { testCatalogCustomResourceWatchReconcilesTableMembership(t, version) })
	}
}

func testCatalogCustomResourceWatchReconcilesTableMembership(t *testing.T, storageVersion string) {
	t.Helper()
	app, target := catalogLifecycleTestApp(t, system.TierForeground, false)
	clients := app.ClusterRuntime.clusterClientsForID(target.meta.ID)
	kube := clients.client.(*kubefake.Clientset)
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		resource := review.Spec.ResourceAttributes.Resource
		review.Status.Allowed = resource == "externalsecrets" || resource == "customresourcedefinitions"
		return true, review, nil
	})
	gvr := schema.GroupVersionResource{Group: "external-secrets.io", Version: storageVersion, Resource: "externalsecrets"}
	catalogGVR := gvr
	catalogGVR.Version = "v1"
	kube.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{GroupVersion: catalogGVR.GroupVersion().String(), APIResources: []metav1.APIResource{{Name: gvr.Resource, Kind: "ExternalSecret", Namespaced: true, Verbs: []string{"list", "watch"}}}}}
	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(gvr.GroupVersion().WithKind("ExternalSecret"))
	resource.SetNamespace("argocd")
	resource.SetName("argocd-saml")
	resource.SetUID("secret-uid")
	resource.SetResourceVersion("1")
	other := resource.DeepCopy()
	other.SetNamespace("other")
	other.SetUID("other-uid")
	dynamic := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "ExternalSecretList", catalogGVR: "ExternalSecretList"}, resource, other)
	// Like an API server, the fake serves the same storage objects through both versions.
	dynamic.PrependReactor("list", gvr.Resource, func(action clienttesting.Action) (bool, runtime.Object, error) {
		list, err := dynamic.Tracker().List(gvr, resource.GroupVersionKind(), action.GetNamespace())
		return true, list, err
	})
	watchStarts := make(chan schema.GroupVersionResource, 8)
	dynamic.PrependWatchReactor(gvr.Resource, func(action clienttesting.Action) (bool, watch.Interface, error) {
		stream, err := dynamic.Tracker().Watch(gvr, action.GetNamespace())
		if err != nil {
			return true, nil, err
		}
		stream = watch.Filter(stream, func(event watch.Event) (watch.Event, bool) {
			object := event.Object.(*unstructured.Unstructured).DeepCopy()
			object.SetGroupVersionKind(action.GetResource().GroupVersion().WithKind("ExternalSecret"))
			event.Object = object
			return event, true
		})
		watchStarts <- action.GetResource()
		return true, stream, err
	})
	clients.dynamicClient = dynamic
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	versions := []apiextensionsv1.CustomResourceDefinitionVersion{{Name: gvr.Version, Served: true, Storage: true}}
	if catalogGVR != gvr {
		versions = append(versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1", Served: true})
	}
	definition := &apiextensionsv1.CustomResourceDefinition{ObjectMeta: metav1.ObjectMeta{Name: "externalsecrets.external-secrets.io", UID: "definition-a"}, Spec: apiextensionsv1.CustomResourceDefinitionSpec{Group: gvr.Group, Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: gvr.Resource, Kind: "ExternalSecret"}, Scope: apiextensionsv1.NamespaceScoped, Versions: versions}}
	_, err := clients.apiextensionsClient.ApiextensionsV1().CustomResourceDefinitions().Create(ctx, definition, metav1.CreateOptions{})
	require.NoError(t, err)
	subsystem, err := system.NewSubsystemWithServices(system.Config{
		KubernetesClient: kube, APIExtensionsClient: clients.apiextensionsClient, DynamicClient: dynamic,
		ClusterID: target.meta.ID, ClusterName: target.meta.Name, Logger: app.AppLogs.Logger(), ResyncInterval: time.Minute,
		ObjectDetailsProvider: app.Resources.objectDetailProvider(), NodeMaintenanceStore: app.NodeMaintenanceStore,
	})
	require.NoError(t, err)
	app.Refresh.setRefreshSubsystem(target.meta.ID, subsystem)
	app.Resources.responseCache = newResponseCache(time.Minute, 10)
	app.Resources.registerResponseCacheInvalidation(subsystem, target.meta.ID)
	t.Cleanup(func() {
		app.Refresh.stopObjectCatalogForCluster(target.meta.ID)
		cancel()
		subsystem.StopDoorbellNotifiers()
		subsystem.ResourceStream.Stop()
		subsystem.IngestManager.Stop()
		_ = subsystem.InformerFactory.Shutdown()
	})
	subsystem.IngestManager.Start(ctx)
	require.NoError(t, subsystem.InformerFactory.Start(ctx))
	selector, err := resourcestream.ParseStreamSelector(target.meta.ID, "catalog", "")
	require.NoError(t, err)
	sub, err := subsystem.ResourceStream.SubscribeSelector(selector)
	require.NoError(t, err)
	defer sub.Cancel()
	require.NoError(t, app.Refresh.startObjectCatalogForTarget(target))
	service := app.Refresh.objectCatalogServiceForCluster(target.meta.ID)
	query := objectcatalog.QueryOptions{Namespaces: []string{"argocd"}}
	require.Eventually(t, func() bool {
		return service.Health().Status == objectcatalog.HealthStateOK && service.Query(query).TotalItems == 1
	}, 3*time.Second, time.Millisecond)
	require.Equal(t, catalogGVR.Version, service.Query(query).Items[0].Ref.Version)
	require.Eventually(t, func() bool {
		source, ok := subsystem.IngestManager.ReadDynamicCatalogSource(gvr.GroupResource())
		return ok && len(source.ReadyNamespaces) > 0 && source.Spec.GVR == catalogGVR
	}, time.Second, time.Millisecond)
	for {
		select {
		case started := <-watchStarts:
			if started != catalogGVR {
				continue
			}
		case <-time.After(time.Second):
			t.Fatal("the selected ingest watch did not start")
		}
		break
	}
	for len(sub.Updates) > 0 {
		<-sub.Updates
	}
	dynamic.ClearActions()
	detailKey := objectDetailCacheKeyForGVK(catalogGVR.GroupVersion().WithKind("ExternalSecret"), "argocd", resource.GetName())
	headerKey := objectHeaderMetadataCacheKey(catalogGVR.GroupVersion().WithKind("ExternalSecret"), "argocd", resource.GetName())
	app.Resources.responseCacheStore(target.meta.ID, detailKey, "old detail")
	app.Resources.responseCacheStore(target.meta.ID, headerKey, "old clock")
	updated := resource.DeepCopy()
	updated.SetResourceVersion("2")
	updated.SetFinalizers([]string{"external-secrets.io/cleanup"})
	deleting := metav1.Now()
	updated.SetDeletionTimestamp(&deleting)
	_, err = dynamic.Resource(gvr).Namespace("argocd").Update(ctx, updated, metav1.UpdateOptions{})
	require.NoError(t, err)
	requireCatalogSignalState(t, sub, "external update and finalizer publication", func() bool {
		rows := service.Query(query).Items
		return len(rows) == 1 && rows[0].ResourceVersion == "2" && len(service.FinalizerBlockers()) == 1
	})
	_, cachedDetail := app.Resources.responseCacheLookup(target.meta.ID, detailKey)
	_, cachedHeader := app.Resources.responseCacheLookup(target.meta.ID, headerKey)
	require.False(t, cachedDetail, "detail invalidation must precede the catalog signal")
	require.False(t, cachedHeader, "the object's source clock must be invalidated with its detail")
	require.NoError(t, dynamic.Resource(gvr).Namespace("argocd").Delete(ctx, resource.GetName(), metav1.DeleteOptions{}))
	requireCatalogSignalState(t, sub, "object deletion", func() bool { return service.Query(query).TotalItems == 0 && len(service.FinalizerBlockers()) == 0 })
	remaining := service.Query(objectcatalog.QueryOptions{}).Items
	require.Len(t, remaining, 1)
	require.Equal(t, "other", remaining[0].Ref.Namespace)
	require.Equal(t, target.meta.ID, remaining[0].Ref.ClusterID)
	require.Equal(t, catalogGVR.Version, remaining[0].Ref.Version)
	for _, action := range dynamic.Actions() {
		require.NotEqual(t, "list", action.GetVerb(), "watch updates must not perform another dynamic LIST")
	}

	// Consumer retirement must retain the generation's source and attach to current rows.
	app.Refresh.stopObjectCatalogForCluster(target.meta.ID)
	dynamic.ClearActions()
	require.NoError(t, app.Refresh.startObjectCatalogForTarget(target))
	replacement := app.Refresh.objectCatalogServiceForCluster(target.meta.ID)
	require.Eventually(t, func() bool {
		return replacement.Health().Status == objectcatalog.HealthStateOK && replacement.Query(objectcatalog.QueryOptions{}).TotalItems == 1
	}, 3*time.Second, time.Millisecond)
	for _, action := range dynamic.Actions() {
		require.NotContains(t, []string{"list", "watch"}, action.GetVerb(), "catalog restart must reuse the live ingest source")
	}
	require.NoError(t, clients.apiextensionsClient.ApiextensionsV1().CustomResourceDefinitions().Delete(ctx, definition.Name, metav1.DeleteOptions{}))
	requireCatalogSignalState(t, sub, "CRD deletion after catalog restart", func() bool { return replacement.Query(objectcatalog.QueryOptions{}).TotalItems == 0 })
	require.False(t, subsystem.IngestManager.Tracks(catalogGVR), "confirmed CRD deletion retires its source")
}

func requireCatalogSignalState(t *testing.T, sub *resourcestream.Subscription, contract string, current func() bool) {
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
			t.Fatalf("%s: catalog signal did not expose the changed table membership before the periodic resync", contract)
		}
	}
}
