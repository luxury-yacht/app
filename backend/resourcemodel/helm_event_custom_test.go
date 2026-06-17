package resourcemodel

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type testResourceResolver map[schema.GroupVersionKind]common.ResolvedResource

func (r testResourceResolver) ResolveResourceForGVK(ctx context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	resolved, ok := r[gvk]
	return resolved, ok, nil
}

var helmTestResolver = testResourceResolver{
	{Group: "apps", Version: "v1", Kind: "Deployment"}: {
		Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespaced: true,
	},
	{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole"}: {
		Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole", Resource: "clusterroles", Namespaced: false,
	},
	{Group: "", Version: "v1", Kind: "ConfigMap"}: {
		Group: "", Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespaced: true,
	},
}

func TestBuildHelmManifestResourceLinkDoesNotGuessMissingAPIVersion(t *testing.T) {
	link := BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(context.Background(), nil, "cluster-a", "", "Deployment", "apps", "orders", true)

	require.Nil(t, link.Ref)
	require.NotNil(t, link.Display)
	require.Equal(t, "Deployment", link.Display.Kind)
	require.Equal(t, "orders", link.Display.Name)
	require.Equal(t, "", link.Display.Version)
}

func TestBuildHelmManifestResourceLinkRespectsBuiltinScope(t *testing.T) {
	clusterRole := BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(
		context.Background(),
		helmTestResolver,
		"cluster-a",
		"rbac.authorization.k8s.io/v1",
		"ClusterRole",
		"release-ns",
		"reader",
		false,
	)
	require.NotNil(t, clusterRole.Ref)
	require.Equal(t, ResourceScopeCluster, ResolveHelmManifestResourceIdentityWithResolver(context.Background(), helmTestResolver, "rbac.authorization.k8s.io/v1", "ClusterRole", "release-ns", "reader", false).Scope)
	require.Equal(t, "ClusterRole", clusterRole.Ref.Kind)
	require.Equal(t, "clusterroles", clusterRole.Ref.Resource)
	require.Empty(t, clusterRole.Ref.Namespace)

	configMap := BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(
		context.Background(),
		helmTestResolver,
		"cluster-a",
		"v1",
		"ConfigMap",
		"release-ns",
		"settings",
		false,
	)
	require.NotNil(t, configMap.Ref)
	require.Equal(t, "ConfigMap", configMap.Ref.Kind)
	require.Equal(t, "configmaps", configMap.Ref.Resource)
	require.Equal(t, "release-ns", configMap.Ref.Namespace)
}

func TestBuildHelmManifestResourceLinkKeepsUnknownDefaultNamespaceDisplayOnly(t *testing.T) {
	link := BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(
		context.Background(),
		nil,
		"cluster-a",
		"databases.example.com/v1alpha1",
		"Database",
		"release-ns",
		"orders",
		false,
	)

	require.Nil(t, link.Ref)
	require.NotNil(t, link.Display)
	require.Equal(t, "Database", link.Display.Kind)
	require.Equal(t, "orders", link.Display.Name)
	require.Equal(t, "release-ns", link.Display.Namespace)
}

func TestBuildHelmManifestResourceLinkKeepsExplicitUnknownNamespaceOpenable(t *testing.T) {
	link := BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(
		context.Background(),
		nil,
		"cluster-a",
		"databases.example.com/v1alpha1",
		"Database",
		"release-ns",
		"orders",
		true,
	)

	require.NotNil(t, link.Ref)
	require.Equal(t, "databases.example.com", link.Ref.Group)
	require.Equal(t, "v1alpha1", link.Ref.Version)
	require.Equal(t, "Database", link.Ref.Kind)
	require.Equal(t, "release-ns", link.Ref.Namespace)
	require.Equal(t, "orders", link.Ref.Name)
}
