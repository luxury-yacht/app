package system

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resources/common"
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

// Construction must register the sole CRD source even below catalog promotion's
// threshold. Counting API watches detects leaving the former stream owner alive.
func TestSubsystemOwnsOneBelowThresholdCustomResourceWatch(t *testing.T) {
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "definition-a"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: gvr.Group, Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: gvr.Resource, Kind: "Widget"},
			Scope: apiextensionsv1.NamespaceScoped, Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
		},
	}
	object := &unstructured.Unstructured{}
	object.SetGroupVersionKind(gvr.GroupVersion().WithKind("Widget"))
	object.SetNamespace("allowed")
	object.SetName("visible")
	object.SetUID("object-a")
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "WidgetList"}, object)
	kube := kubefake.NewClientset()
	kube.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: []string{"list", "watch"}}}}}
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		attrs := review.Spec.ResourceAttributes
		review.Status.Allowed = attrs.Resource == "customresourcedefinitions" || attrs.Resource == "widgets"
		return true, review, nil
	})
	// The subsystem's reflectors run against an API server holding the CRD; the
	// catalog's discovery and access reviews use the fake client.
	server := newReflectorAPIServer(t)
	server.Allow(func(attrs authorizationv1.ResourceAttributes) bool {
		return attrs.Resource == "customresourcedefinitions" || attrs.Resource == "widgets"
	})
	server.Create(t, crd)
	subsystem, err := NewSubsystemWithServices(context.Background(), Config{KubernetesClient: server.Client(t), APIExtensionsClient: server.APIExtensionsClient(t), DynamicClient: dyn, ClusterID: "test-cluster", Logger: applog.Noop, ObjectDetailsProvider: noopObjectDetailProvider{}, NodeMaintenanceStore: nodemaintenance.NewStore(5)})
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(func() {
		cancel()
		subsystem.ResourceStream.Stop()
		subsystem.IngestManager.Stop()
	})
	subsystem.IngestManager.Start(ctx)
	catalog := objectcatalog.NewService(objectcatalog.Dependencies{
		ClusterID: "test-cluster", Common: common.Dependencies{KubernetesClient: kube, DynamicClient: dyn},
		IngestSource: subsystem.IngestManager,
	}, nil)
	catalogDone := make(chan error, 1)
	go func() { catalogDone <- catalog.Run(ctx) }()
	t.Cleanup(func() { cancel(); <-catalogDone })
	require.Eventually(t, func() bool {
		source, ok := subsystem.IngestManager.ReadDynamicCatalogSource(gvr.GroupResource())
		return ok && len(source.ReadyNamespaces) > 0 && len(source.Rows) == 1
	}, 3*time.Second, 10*time.Millisecond, "production construction must ingest a CRD with one object")
	rows := subsystem.IngestManager.CatalogRows(gvr)
	require.Equal(t, "test-cluster", rows[0].(objectcatalog.Summary).Ref.ClusterID)
	require.Eventually(t, func() bool {
		count := 0
		for _, action := range dyn.Actions() {
			if action.GetVerb() == "watch" && action.GetResource() == gvr {
				count++
			}
		}
		return count == 1
	}, time.Second, time.Millisecond)
	time.Sleep(50 * time.Millisecond)
	count := 0
	for _, action := range dyn.Actions() {
		if action.GetVerb() == "watch" && action.GetResource() == gvr {
			count++
		}
	}
	require.Equal(t, 1, count, "custom resources must not retain a second stream-manager watch")
}
