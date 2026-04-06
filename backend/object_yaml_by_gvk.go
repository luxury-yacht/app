/*
 * backend/object_yaml_by_gvk.go
 *
 * GVK-aware object YAML fetch. Part of the kind-only-objects fix (see
 * docs/plans/kind-only-objects.md, step 3).
 *
 * Unlike the legacy App.GetObjectYAML, this entry point takes a full
 * apiVersion + kind from the caller and resolves through the strict
 * common.ResolveGVRForGVK helper. That lets the caller choose which of
 * several colliding CRDs to read, instead of getting whichever one the
 * discovery client happens to yield first.
 *
 * The core fetch logic is extracted into fetchObjectYAMLByGVK so the
 * refresh-domain provider (backend/object_detail_provider.go) can share it
 * without a second trip through resolveClusterDependencies.
 */

package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"
)

// GetObjectYAMLByGVK fetches a Kubernetes object by its fully-qualified
// apiVersion + kind and returns its YAML representation. apiVersion must
// be in the standard Kubernetes "group/version" form (or just "version"
// for core resources like "v1").
//
// Unlike GetObjectYAML, this function resolves the GVR strictly from the
// supplied group/version/kind and does not fall back to first-match-wins
// on bare kind. That's the whole point of the fix — callers that know
// which CRD they want can get exactly that one, even when another CRD
// registers the same Kind under a different group.
func (a *App) GetObjectYAMLByGVK(clusterID, apiVersion, kind, namespace, name string) (string, error) {
	gvk := schema.FromAPIVersionAndKind(strings.TrimSpace(apiVersion), strings.TrimSpace(kind))
	if gvk.Kind == "" {
		return "", fmt.Errorf("kind is required")
	}
	if gvk.Version == "" {
		return "", fmt.Errorf("apiVersion is required")
	}

	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", err
	}
	return fetchObjectYAMLByGVK(deps.Context, deps, gvk, namespace, name)
}

// fetchObjectYAMLByGVK is the shared core: given already-resolved
// cluster-scoped dependencies and a fully-qualified GroupVersionKind,
// return the object's YAML or an error. Exposed for reuse by the
// refresh-domain provider at backend/object_detail_provider.go.
func fetchObjectYAMLByGVK(ctx context.Context, deps common.Dependencies, gvk schema.GroupVersionKind, namespace, name string) (string, error) {
	if deps.DynamicClient == nil {
		return "", fmt.Errorf("dynamic client not initialized")
	}
	if ctx == nil {
		ctx = deps.Context
		if ctx == nil {
			ctx = context.Background()
		}
	}

	gvr, isNamespaced, err := common.ResolveGVRForGVK(ctx, deps, gvk)
	if err != nil {
		return "", err
	}

	var obj *unstructured.Unstructured
	if isNamespaced {
		if strings.TrimSpace(namespace) == "" {
			return "", fmt.Errorf("namespaced resource %s requires a namespace", gvr.String())
		}
		obj, err = deps.DynamicClient.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		obj, err = deps.DynamicClient.Resource(gvr).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		if apierrors.IsNotFound(err) {
			return "", fmt.Errorf("%s %q not found in namespace %q", gvk.String(), name, namespace)
		}
		return "", fmt.Errorf("failed to get %s %s: %w", gvk.String(), name, err)
	}

	yamlBytes, err := yaml.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("failed to convert to YAML: %w", err)
	}
	return string(yamlBytes), nil
}
