package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type appResourceResolver struct {
	app       *App
	clusterID string
}

func (r appResourceResolver) ResolveResourceForGVK(ctx context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	if r.app == nil {
		return common.ResolvedResource{}, false, nil
	}
	svc := r.app.objectCatalogServiceForCluster(r.clusterID)
	if svc == nil {
		resolver, ok := r.app.fallbackResourceResolverForCluster(r.clusterID)
		if !ok {
			return common.ResolvedResource{}, false, nil
		}
		return resolver.ResolveResourceForGVK(ctx, gvk)
	}
	return svc.ResolveResourceForGVK(ctx, gvk)
}

func (a *App) fallbackResourceResolverForCluster(clusterID string) (common.ResourceResolver, bool) {
	if a == nil || strings.TrimSpace(clusterID) == "" {
		return nil, false
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	clients := a.clusterClients[clusterID]
	if clients == nil {
		return nil, false
	}
	if clients.fallbackResourceResolver != nil {
		return clients.fallbackResourceResolver, true
	}

	selection := kubeconfigSelection{
		Path:    clients.kubeconfigPath,
		Context: clients.kubeconfigContext,
	}
	deps := a.resourceDependenciesForSelection(selection, clients, clusterID)
	deps.ResourceResolver = nil
	resolver := objectcatalog.NewResourceResolver(deps, deps.Logger)
	clients.fallbackResourceResolver = resolver
	return resolver, true
}

// resourceDependenciesForClusterID resolves dependencies for a specific cluster selection.
func (a *App) resourceDependenciesForClusterID(clusterID string) (common.Dependencies, bool) {
	if a == nil || strings.TrimSpace(clusterID) == "" {
		return common.Dependencies{}, false
	}

	clients := a.clusterClientsForID(clusterID)
	if clients == nil {
		return common.Dependencies{}, false
	}

	selection := kubeconfigSelection{
		Path:    clients.kubeconfigPath,
		Context: clients.kubeconfigContext,
	}

	return a.resourceDependenciesForSelection(selection, clients, clusterID), true
}

// resolveClusterDependencies ensures callers operate on a specific active cluster.
func (a *App) resolveClusterDependencies(clusterID string) (common.Dependencies, string, error) {
	trimmed := strings.TrimSpace(clusterID)
	if trimmed == "" {
		return common.Dependencies{}, "", fmt.Errorf("cluster id is required")
	}

	// Check auth state before returning dependencies.
	// This prevents making requests to clusters with invalid auth.
	clients := a.clusterClientsForID(trimmed)
	if clients != nil && clients.authManager != nil && !clients.authManager.IsValid() {
		clusterName := trimmed
		if clients.meta.Name != "" {
			clusterName = clients.meta.Name
		}
		return common.Dependencies{}, "", fmt.Errorf("auth failed for %s: check your kubeconfig credentials", clusterName)
	}

	deps, ok := a.resourceDependenciesForClusterID(trimmed)
	if !ok {
		return common.Dependencies{}, "", fmt.Errorf("cluster %s not active", trimmed)
	}

	return deps, trimmed, nil
}
