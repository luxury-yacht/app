package backend

import "github.com/luxury-yacht/app/backend/resources/generic"

func (a *App) DeleteResource(clusterID, resourceKind, namespace, name string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	service := generic.NewService(generic.Dependencies{Common: deps})
	return service.Delete(resourceKind, namespace, name)
}
