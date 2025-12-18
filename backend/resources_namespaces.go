package backend

import "github.com/luxury-yacht/app/backend/resources/namespaces"

func (a *App) GetNamespace(name string) (*NamespaceDetails, error) {
	deps := namespaces.Dependencies{Common: a.resourceDependencies()}
	return FetchClusterResource(a, "Namespace", name, func() (*NamespaceDetails, error) {
		return namespaces.NewService(deps).Namespace(name)
	})
}
