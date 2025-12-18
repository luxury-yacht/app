package backend

import "github.com/luxury-yacht/app/backend/resources/generic"

func (a *App) DeleteResource(resourceKind, namespace, name string) error {
	service := generic.NewService(generic.Dependencies{Common: a.resourceDependencies()})
	return service.Delete(resourceKind, namespace, name)
}
