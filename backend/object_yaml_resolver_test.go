/*
 * backend/object_yaml_resolver_test.go
 *
 * Verifies strict and mutation-fallback GVK resolution policy for YAML
 * workflows.
 */

package backend

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
)

type failingResourceResolver struct{}

func (failingResourceResolver) ResolveResourceForGVK(context.Context, schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	return common.ResolvedResource{}, false, errors.New("strict resolver failed")
}

func TestObjectYAMLResolverStrictDoesNotUseKindFallback(t *testing.T) {
	deps := objectYAMLResolverFallbackDeps()
	gvk := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}

	_, _, err := resolveObjectYAMLGVR(context.Background(), deps, gvk, objectYAMLResolverStrict)
	require.ErrorContains(t, err, "strict resolver failed")
}

func TestObjectYAMLResolverMutationFallbackValidatesGVK(t *testing.T) {
	deps := objectYAMLResolverFallbackDeps()
	gvk := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}

	gvr, namespaced, err := resolveObjectYAMLGVR(
		context.Background(),
		deps,
		gvk,
		objectYAMLResolverMutationFallback,
	)
	require.NoError(t, err)
	require.True(t, namespaced)
	require.Equal(t, schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, gvr)
}

func TestObjectYAMLResolverMutationFallbackRejectsWrongGroup(t *testing.T) {
	deps := objectYAMLResolverFallbackDeps()
	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Deployment"}

	_, _, err := resolveObjectYAMLGVR(
		context.Background(),
		deps,
		gvk,
		objectYAMLResolverMutationFallback,
	)
	require.ErrorContains(t, err, "strict resolver failed")
}

func objectYAMLResolverFallbackDeps() common.Dependencies {
	client := fake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{{
		GroupVersion: "apps/v1",
		APIResources: []metav1.APIResource{{
			Name:       "deployments",
			Kind:       "Deployment",
			Namespaced: true,
		}},
	}}
	return common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
		ResourceResolver: failingResourceResolver{},
	}
}
