package backend

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"github.com/stretchr/testify/require"
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

func TestOperatorDetailsAndHydrationResolveReferencesFromClusterDiscovery(t *testing.T) {
	client := fake.NewClientset()
	client.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{
		{GroupVersion: "cert-manager.io/v1", APIResources: []metav1.APIResource{{Name: "clusterissuers", Kind: "ClusterIssuer", Verbs: metav1.Verbs{"get", "list"}}}},
		{GroupVersion: "cert-manager.io/v1beta1", APIResources: []metav1.APIResource{{Name: "certificates", Kind: "Certificate", Namespaced: true, Verbs: metav1.Verbs{"get", "list"}}}},
		{GroupVersion: "external-secrets.io/v1", APIResources: []metav1.APIResource{{Name: "externalsecrets", Kind: "ExternalSecret", Namespaced: true, Verbs: metav1.Verbs{"get", "list"}}, {Name: "secretstores", Kind: "SecretStore", Namespaced: true, Verbs: metav1.Verbs{"get", "list"}}}},
	}
	certificate := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "cert-manager.io/v1beta1", "kind": "Certificate", "metadata": map[string]any{"name": "tls", "namespace": "team-a"}, "spec": map[string]any{"issuerRef": map[string]any{"name": "public", "kind": "ClusterIssuer"}, "secretName": "tls-secret"}}}
	secret := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "external-secrets.io/v1", "kind": "ExternalSecret", "metadata": map[string]any{"name": "db", "namespace": "team-a"}, "spec": map[string]any{"secretStoreRef": map[string]any{"name": "vault", "kind": "SecretStore"}}}}
	dynamic := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), certificate, secret)
	gateway := newObjectDetailResourceGateway(map[string]*clusterClients{"a": {meta: ClusterMeta{ID: "a", Name: "a"}, client: client, dynamicClient: dynamic}})
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: "a"})
	provider := gateway.objectDetailProvider()
	raw, err := provider.FetchObjectDetails(ctx, certificate.GroupVersionKind(), "team-a", "tls")
	require.NoError(t, err)
	require.NotNil(t, raw.(*customresource.Details).CertManager.Issuer.Display)
	catalog := objectcatalog.NewService(objectcatalog.Dependencies{ClusterID: "a", Common: common.Dependencies{KubernetesClient: client}}, nil)
	_, found, err := catalog.ResolveResourceForGVK(ctx, schema.GroupVersionKind{Group: "cert-manager.io", Version: "v1", Kind: "ClusterIssuer"})
	require.NoError(t, err)
	require.True(t, found)
	gateway.refreshProjection.publishCatalogEntry("a", &objectCatalogEntry{service: catalog, meta: ClusterMeta{ID: "a"}})
	rows, err := gateway.HydrateCatalogCustomRows("a", []snapshot.ResourceQueryRow{
		{ClusterID: "a", Group: "cert-manager.io", Version: "v1beta1", Kind: "Certificate", Resource: "certificates", Namespace: "team-a", Name: "tls"},
		{ClusterID: "a", Group: "external-secrets.io", Version: "v1", Kind: "ExternalSecret", Resource: "externalsecrets", Namespace: "team-a", Name: "db"},
	})
	require.NoError(t, err)
	require.Len(t, rows, 2)
	raw, err = provider.FetchObjectDetails(ctx, certificate.GroupVersionKind(), "team-a", "tls")
	require.NoError(t, err)
	certificateFacts := raw.(*customresource.Details).CertManager
	require.Equal(t, rows[0].CertManager.Issuer, certificateFacts.Issuer)
	require.Equal(t, "v1", certificateFacts.Issuer.Ref.Version)
	require.Equal(t, "a", certificateFacts.Issuer.Ref.ClusterID)
	require.Empty(t, certificateFacts.Issuer.Ref.Namespace)
	raw, err = provider.FetchObjectDetails(ctx, secret.GroupVersionKind(), "team-a", "db")
	require.NoError(t, err)
	secretFacts := raw.(*customresource.Details).ExternalSecrets.ExternalSecret
	require.Equal(t, rows[1].ExternalSecrets.Store, secretFacts.Store)
	require.Equal(t, "team-a", secretFacts.Store.Ref.Namespace)
	require.Equal(t, "db", secretFacts.Target.Ref.Name)
	for _, action := range dynamic.Actions() {
		require.NotEqual(t, "secrets", action.GetResource().Resource, "projections must not fetch Secret values")
	}
	dynamic.PrependReactor("get", "certificates", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "cert-manager.io", Resource: "certificates"}, "tls", nil)
	})
	_, err = provider.FetchObjectDetails(ctx, certificate.GroupVersionKind(), "team-a", "tls")
	require.Error(t, err)
}
