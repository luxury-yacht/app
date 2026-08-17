/*
 * backend/resources_helm.go
 *
 * App-level Helm resource wrappers.
 * - Fetches Helm release details, manifests, and values.
 */

package backend

import (
	"context"

	"github.com/luxury-yacht/app/backend/resources/helm"
)

func (g *ResourceGateway) GetHelmReleaseDetails(clusterID, namespace, name string) (*HelmReleaseDetails, error) {
	deps, selectionKey, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	helmDeps := helm.Dependencies{Common: deps}
	return FetchNamespacedResource(g, deps, selectionKey, "HelmRelease", namespace, name, func(ctx context.Context) (*HelmReleaseDetails, error) {
		return helm.NewService(helmDeps).ReleaseDetails(ctx, namespace, name)
	})
}

func (g *ResourceGateway) GetHelmManifest(clusterID, namespace, name string) (string, error) {
	deps, selectionKey, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", err
	}
	helmDeps := helm.Dependencies{Common: deps}
	return FetchNamespacedResource(g, deps, selectionKey, "HelmManifest", namespace, name, func(context.Context) (string, error) {
		return helm.NewService(helmDeps).ReleaseManifest(namespace, name)
	})
}

func (g *ResourceGateway) GetHelmValues(clusterID, namespace, name string) (map[string]interface{}, error) {
	deps, selectionKey, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	helmDeps := helm.Dependencies{Common: deps}
	return FetchNamespacedResource(g, deps, selectionKey, "HelmValues", namespace, name, func(context.Context) (map[string]interface{}, error) {
		return helm.NewService(helmDeps).ReleaseValues(namespace, name)
	})
}
