/*
 * backend/resources_rbac.go
 *
 * App-level RBAC resource wrappers.
 * - Exposes role, binding, and service account handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/rbac"

func (a *App) GetClusterRole(name string) (*ClusterRoleDetails, error) {
	deps := a.resourceDependencies()
	return FetchClusterResource(a, "ClusterRole", name, func() (*ClusterRoleDetails, error) {
		return rbac.NewService(deps).ClusterRole(name)
	})
}

func (a *App) GetClusterRoleBinding(name string) (*ClusterRoleBindingDetails, error) {
	deps := a.resourceDependencies()
	return FetchClusterResource(a, "ClusterRoleBinding", name, func() (*ClusterRoleBindingDetails, error) {
		return rbac.NewService(deps).ClusterRoleBinding(name)
	})
}

func (a *App) GetRole(namespace, name string) (*RoleDetails, error) {
	deps := a.resourceDependencies()
	return FetchNamespacedResource(a, "Role", namespace, name, func() (*RoleDetails, error) {
		return rbac.NewService(deps).Role(namespace, name)
	})
}

func (a *App) GetRoleBinding(namespace, name string) (*RoleBindingDetails, error) {
	deps := a.resourceDependencies()
	return FetchNamespacedResource(a, "RoleBinding", namespace, name, func() (*RoleBindingDetails, error) {
		return rbac.NewService(deps).RoleBinding(namespace, name)
	})
}

func (a *App) GetServiceAccount(namespace, name string) (*ServiceAccountDetails, error) {
	deps := a.resourceDependencies()
	return FetchNamespacedResource(a, "ServiceAccount", namespace, name, func() (*ServiceAccountDetails, error) {
		return rbac.NewService(deps).ServiceAccount(namespace, name)
	})
}
