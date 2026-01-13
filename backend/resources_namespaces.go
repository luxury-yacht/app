/*
 * backend/resources_namespaces.go
 *
 * App-level namespace resource wrappers.
 * - Exposes Namespace detail handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/namespaces"

func (a *App) GetNamespace(clusterID, name string) (*NamespaceDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "Namespace", name, func() (*NamespaceDetails, error) {
		return namespaces.NewService(deps).Namespace(name)
	})
}
