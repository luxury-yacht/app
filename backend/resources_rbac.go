/*
 * backend/resources_rbac.go
 *
 * App-level RBAC resource wrappers.
 * - Exposes role, binding, and service account handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/rbac"

func (a *App) GetClusterRole(clusterID, name string) (*ClusterRoleDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "ClusterRole", name, func() (*ClusterRoleDetails, error) {
		return rbac.NewService(deps).ClusterRole(name)
	})
}

func (a *App) GetClusterRoleBinding(clusterID, name string) (*ClusterRoleBindingDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "ClusterRoleBinding", name, func() (*ClusterRoleBindingDetails, error) {
		return rbac.NewService(deps).ClusterRoleBinding(name)
	})
}

func (a *App) GetRole(clusterID, namespace, name string) (*RoleDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "Role", namespace, name, func() (*RoleDetails, error) {
		return rbac.NewService(deps).Role(namespace, name)
	})
}

func (a *App) GetRoleBinding(clusterID, namespace, name string) (*RoleBindingDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "RoleBinding", namespace, name, func() (*RoleBindingDetails, error) {
		return rbac.NewService(deps).RoleBinding(namespace, name)
	})
}

func (a *App) GetServiceAccount(clusterID, namespace, name string) (*ServiceAccountDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "ServiceAccount", namespace, name, func() (*ServiceAccountDetails, error) {
		return rbac.NewService(deps).ServiceAccount(namespace, name)
	})
}
