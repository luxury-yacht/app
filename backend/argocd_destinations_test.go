package backend

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestArgoCDDestinationNamesUseScopedRegistrationsAndTolerateDeniedSecrets(t *testing.T) {
	ctx := context.Background()
	gvk := schema.GroupVersionKind{Group: "argoproj.io", Version: "v1alpha1", Kind: "Application"}
	scheme := runtime.NewScheme()
	require.NoError(t, corev1.AddToScheme(scheme))
	application := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": gvk.GroupVersion().String(), "kind": gvk.Kind,
		"metadata": map[string]any{"namespace": "team-a", "name": "shop", "resourceVersion": "1"},
		"spec":     map[string]any{"destination": map[string]any{"server": "https://prod.example.com", "namespace": "store"}},
		"status":   map[string]any{"controllerNamespace": "argo-system"},
	}}
	registration := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "cluster-prod", Namespace: "argo-system", Labels: map[string]string{"argocd.argoproj.io/secret-type": "cluster"}}, Data: map[string][]byte{
		"server": []byte("https://prod.example.com"), "name": []byte("Remote Production"), "config": []byte(`{"bearerToken":"never-project-this"}`),
	}}
	wrongNamespace := registration.DeepCopy()
	wrongNamespace.Namespace = "team-a"
	wrongNamespace.Data["name"] = []byte("Wrong installation")
	client := dynamicfake.NewSimpleDynamicClient(scheme, application, registration, wrongNamespace)
	otherRegistration := registration.DeepCopy()
	otherRegistration.Data["name"] = []byte("Other cluster registration")
	otherClient := dynamicfake.NewSimpleDynamicClient(scheme, application.DeepCopy(), otherRegistration)
	kube := fake.NewClientset()
	kube.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{GroupVersion: gvk.GroupVersion().String(), APIResources: []metav1.APIResource{{Name: "applications", Kind: gvk.Kind, Namespaced: true, Verbs: metav1.Verbs{"list", "get"}}}}}
	gateway := newObjectDetailResourceGateway(map[string]*clusterClients{
		"a": {meta: ClusterMeta{ID: "a", Name: "Luxury Yacht name"}, client: kube, dynamicClient: client},
		"b": {meta: ClusterMeta{ID: "b", Name: "Other Luxury Yacht name"}, client: kube, dynamicClient: otherClient},
	})
	row := snapshot.ResourceQueryRow{ClusterID: "a", Group: gvk.Group, Version: gvk.Version, Kind: gvk.Kind, Resource: "applications", Namespace: "team-a", Name: "shop"}
	rows, err := gateway.HydrateCatalogCustomRows("a", []snapshot.ResourceQueryRow{row, row})
	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.Equal(t, "Remote Production", rows[0].ArgoCD.Destination)
	require.Equal(t, "Remote Production", rows[1].ArgoCD.Destination)
	secretLists := 0
	for _, action := range client.Actions() {
		if action.Matches("list", "secrets") {
			secretLists++
			require.Equal(t, "argo-system", action.GetNamespace())
			require.Equal(t, "argocd.argoproj.io/secret-type=cluster", action.(ktesting.ListAction).GetListRestrictions().Labels.String())
		}
	}
	require.Equal(t, 1, secretLists, "one lookup shared by the page's rows")
	row.ClusterID = "b"
	otherRows, err := gateway.HydrateCatalogCustomRows("b", []snapshot.ResourceQueryRow{row})
	require.NoError(t, err)
	require.Equal(t, "Other cluster registration", otherRows[0].ArgoCD.Destination)
	row.ClusterID = "a"

	registry := domain.New()
	require.NoError(t, snapshot.RegisterObjectDetailsDomain(registry, gateway.objectDetailProvider()))
	service := snapshot.NewServiceWithPermissions(registry, nil, snapshot.ClusterMeta{ClusterID: "a"}, nil)
	first, err := service.Build(ctx, "object-details", "team-a:argoproj.io/v1alpha1:application:shop")
	require.NoError(t, err)
	encoded, err := json.Marshal(first.Payload)
	require.NoError(t, err)
	require.Contains(t, string(encoded), `"resolvedName":"Remote Production"`)
	require.NotContains(t, string(encoded), "never-project-this")

	registration.Data["name"] = []byte("Renamed Production")
	updated, err := runtime.DefaultUnstructuredConverter.ToUnstructured(registration)
	require.NoError(t, err)
	_, err = client.Resource(corev1.SchemeGroupVersion.WithResource("secrets")).Namespace(registration.Namespace).Update(ctx, &unstructured.Unstructured{Object: updated}, metav1.UpdateOptions{})
	require.NoError(t, err)
	second, err := service.Build(ctx, "object-details", "team-a:argoproj.io/v1alpha1:application:shop")
	require.NoError(t, err)
	require.Equal(t, first.Version, second.Version, "the Application itself did not change")
	require.NotEqual(t, first.SourceVersion, second.SourceVersion, "renaming the registration must invalidate the HTTP validator")

	client.PrependReactor("list", "secrets", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "", nil)
	})
	rows, err = gateway.HydrateCatalogCustomRows("a", []snapshot.ResourceQueryRow{row})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "https://prod.example.com", rows[0].ArgoCD.Destination)
	denied, err := service.Build(ctx, "object-details", "team-a:argoproj.io/v1alpha1:application:shop")
	require.NoError(t, err)
	require.NotEqual(t, second.SourceVersion, denied.SourceVersion)
	details := denied.Payload.(snapshot.ObjectDetailsSnapshotPayload).Details.(*customresource.Details)
	require.Equal(t, "https://prod.example.com", details.ArgoCD.Application.Spec.Destination.Server)
	encoded, err = json.Marshal(details.ArgoCD)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "resolvedName")
}
