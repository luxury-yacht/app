package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// Replace only Kubernetes clients: the catalog's watch of a discovered Argo CD Application
// reaches Attention through the production subsystem and catalog bridges.
func TestCatalogFlagsArgoCDApplicationProblems(t *testing.T) {
	app, target := catalogLifecycleTestApp(t, system.TierForeground, false)
	clients := app.ClusterRuntime.clusterClientsForID(target.meta.ID)
	kube := clients.client.(*kubefake.Clientset)
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		resource := review.Spec.ResourceAttributes.Resource
		review.Status.Allowed = resource == "applications" || resource == "customresourcedefinitions"
		return true, review, nil
	})
	gvr := schema.GroupVersionResource{Group: "argoproj.io", Version: "v1alpha1", Resource: "applications"}
	kube.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{
		GroupVersion: gvr.GroupVersion().String(),
		APIResources: []metav1.APIResource{{Name: gvr.Resource, Kind: "Application", Namespaced: true, Verbs: []string{"list", "watch"}}},
	}}
	application := &unstructured.Unstructured{}
	application.SetGroupVersionKind(gvr.GroupVersion().WithKind("Application"))
	application.SetNamespace("argocd")
	application.SetName("storefront")
	application.SetUID("app-uid")
	application.SetResourceVersion("1")
	require.NoError(t, unstructured.SetNestedField(application.Object, "OutOfSync", "status", "sync", "status"))
	require.NoError(t, unstructured.SetNestedField(application.Object, "Degraded", "status", "health", "status"))
	require.NoError(t, unstructured.SetNestedField(application.Object, "Failed", "status", "operationState", "phase"))
	require.NoError(t, unstructured.SetNestedSlice(application.Object, []any{
		map[string]any{"type": "ComparisonError", "message": "repository not accessible"},
	}, "status", "conditions"))
	dynamic := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "ApplicationList"}, application)
	clients.dynamicClient = dynamic
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	definition := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "applications.argoproj.io", UID: "definition-a"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: gvr.Group, Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: gvr.Resource, Kind: "Application"},
			Scope: apiextensionsv1.NamespaceScoped, Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: gvr.Version, Served: true, Storage: true}},
		},
	}
	_, err := clients.apiextensionsClient.ApiextensionsV1().CustomResourceDefinitions().Create(ctx, definition, metav1.CreateOptions{})
	require.NoError(t, err)
	subsystem, err := system.NewSubsystemWithServices(context.Background(), system.Config{
		KubernetesClient: kube, APIExtensionsClient: clients.apiextensionsClient, DynamicClient: dynamic,
		ClusterID: target.meta.ID, ClusterName: target.meta.Name, Logger: app.AppLogs.Logger(), ResyncInterval: time.Minute,
		ObjectDetailsProvider: app.Resources.objectDetailProvider(), NodeMaintenanceStore: app.NodeMaintenanceStore,
	})
	require.NoError(t, err)
	require.NotNil(t, subsystem.AttentionIndex)
	app.Refresh.setRefreshSubsystem(target.meta.ID, subsystem)
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
	require.NoError(t, app.Refresh.startObjectCatalogForTarget(target))
	service := app.Refresh.objectCatalogServiceForCluster(target.meta.ID)
	require.Eventually(t, func() bool {
		return service.Health().Status == objectcatalog.HealthStateOK && len(service.ReportedStatuses()) == 1
	}, 3*time.Second, time.Millisecond)

	// Every problem is flagged as soon as the catalog sees it.
	index := subsystem.AttentionIndex
	causeTypes := func() []string {
		rows := index.Snapshot()
		if len(rows) != 1 || rows[0].Ref.Name != "storefront" || rows[0].Ref.Group != "argoproj.io" {
			return nil
		}
		types := make([]string, 0, len(rows[0].Causes))
		for _, cause := range rows[0].Causes {
			types = append(types, cause.Type)
		}
		return types
	}
	require.Eventually(t, func() bool { return len(causeTypes()) == 4 }, 3*time.Second, time.Millisecond)
	require.ElementsMatch(t, []string{
		"argocd-application-degraded", "argocd-application-out-of-sync", "argocd-application-sync-failed", "argocd-application-error",
	}, causeTypes())

	// Once Argo CD reports a successful sync and no conditions, the watch clears the finding.
	synced := application.DeepCopy()
	synced.SetResourceVersion("2")
	require.NoError(t, unstructured.SetNestedField(synced.Object, "Synced", "status", "sync", "status"))
	require.NoError(t, unstructured.SetNestedField(synced.Object, "Healthy", "status", "health", "status"))
	require.NoError(t, unstructured.SetNestedField(synced.Object, "Succeeded", "status", "operationState", "phase"))
	unstructured.RemoveNestedField(synced.Object, "status", "conditions")
	_, err = dynamic.Resource(gvr).Namespace("argocd").Update(ctx, synced, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.Eventually(t, func() bool { return len(index.Snapshot()) == 0 }, 3*time.Second, time.Millisecond)
}
