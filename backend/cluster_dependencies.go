package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type clusterRuntimeResourceResolver struct {
	runtime        *ClusterRuntimeManager
	clusterID      string
	catalogService func(string) *objectcatalog.Service
}

func (r clusterRuntimeResourceResolver) ResolveResourceForGVK(ctx context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	if r.catalogService != nil {
		if service := r.catalogService(r.clusterID); service != nil {
			return service.ResolveResourceForGVK(ctx, gvk)
		}
	}
	if r.runtime == nil {
		return common.ResolvedResource{}, false, nil
	}
	resolver, ok := r.runtime.fallbackResourceResolverForCluster(r.clusterID)
	if !ok {
		return common.ResolvedResource{}, false, nil
	}
	return resolver.ResolveResourceForGVK(ctx, gvk)
}

func (m *ClusterRuntimeManager) fallbackResourceResolverForCluster(clusterID string) (common.ResourceResolver, bool) {
	if m == nil || strings.TrimSpace(clusterID) == "" {
		return nil, false
	}
	m.clusterClientsMu.Lock()
	defer m.clusterClientsMu.Unlock()

	clients := m.clusterClients[clusterID]
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
	deps := m.resourceDependenciesForSelection(selection, clients, clusterID)
	deps.ResourceResolver = nil
	resolver := objectcatalog.NewResourceResolver(deps, deps.Logger)
	clients.fallbackResourceResolver = resolver
	return resolver, true
}

// resourceDependenciesForClusterID resolves dependencies for a specific cluster selection.
func (m *ClusterRuntimeManager) resourceDependenciesForClusterID(clusterID string) (common.Dependencies, bool) {
	if m == nil || strings.TrimSpace(clusterID) == "" {
		return common.Dependencies{}, false
	}

	clients := m.clusterClientsForID(clusterID)
	if clients == nil {
		return common.Dependencies{}, false
	}

	selection := kubeconfigSelection{
		Path:    clients.kubeconfigPath,
		Context: clients.kubeconfigContext,
	}

	return m.resourceDependenciesForSelection(selection, clients, clusterID), true
}

// resolveClusterDependencies ensures callers operate on a specific active cluster.
func (m *ClusterRuntimeManager) resolveClusterDependencies(clusterID string) (common.Dependencies, string, error) {
	trimmed := strings.TrimSpace(clusterID)
	if trimmed == "" {
		return common.Dependencies{}, "", fmt.Errorf("cluster id is required")
	}

	// Check auth state before returning dependencies.
	// This prevents making requests to clusters with invalid auth.
	clients := m.clusterClientsForID(trimmed)
	if clients != nil && clients.authManager != nil && !clients.authManager.IsValid() {
		clusterName := trimmed
		if clients.meta.Name != "" {
			clusterName = clients.meta.Name
		}
		return common.Dependencies{}, "", fmt.Errorf("auth failed for %s: check your kubeconfig credentials", clusterName)
	}

	deps, ok := m.resourceDependenciesForClusterID(trimmed)
	if !ok {
		return common.Dependencies{}, "", fmt.Errorf("cluster %s not active", trimmed)
	}
	deps.Logger = applog.OperationScoped(deps.Logger, applog.NextOperationID("wails"))

	return deps, trimmed, nil
}

func (m *ClusterRuntimeManager) ResolveClusterDependencies(clusterID string) (common.Dependencies, string, error) {
	return m.resolveClusterDependencies(clusterID)
}
