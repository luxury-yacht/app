/*
 * backend/resources_apiextensions.go
 *
 * App-level API extensions resource wrappers.
 * - Exposes CustomResourceDefinition handlers.
 */

package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

func (g *ResourceGateway) GetCustomResourceDefinition(clusterID, name string) (*CustomResourceDefinitionDetails, error) {
	deps, selectionKey, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	if deps.APIExtensionsClient == nil {
		return nil, fmt.Errorf("apiextensions client not initialized")
	}
	return FetchClusterResource(g, deps, selectionKey, "CustomResourceDefinition", name, func(ctx context.Context) (*CustomResourceDefinitionDetails, error) {
		return apiextensions.NewService(deps).CustomResourceDefinition(ctx, name)
	})
}
