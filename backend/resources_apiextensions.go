/*
 * backend/resources_apiextensions.go
 *
 * App-level API extensions resource wrappers.
 * - Exposes CustomResourceDefinition handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/apiextensions"

func (a *App) GetCustomResourceDefinition(name string) (*CustomResourceDefinitionDetails, error) {
	deps := a.resourceDependencies()
	return FetchClusterResource(a, "CustomResourceDefinition", name, func() (*CustomResourceDefinitionDetails, error) {
		return apiextensions.NewService(deps).CustomResourceDefinition(name)
	})
}
