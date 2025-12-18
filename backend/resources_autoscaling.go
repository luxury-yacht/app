package backend

import "github.com/luxury-yacht/app/backend/resources/autoscaling"

func (a *App) GetHorizontalPodAutoscaler(namespace, name string) (*HorizontalPodAutoscalerDetails, error) {
	deps := autoscaling.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "HPA", namespace, name, func() (*HorizontalPodAutoscalerDetails, error) {
		return autoscaling.NewService(deps).HorizontalPodAutoscaler(namespace, name)
	})
}
