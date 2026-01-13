/*
 * backend/resources_autoscaling.go
 *
 * App-level autoscaling resource wrappers.
 * - Exposes HorizontalPodAutoscaler handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/autoscaling"

func (a *App) GetHorizontalPodAutoscaler(clusterID, namespace, name string) (*HorizontalPodAutoscalerDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "HPA", namespace, name, func() (*HorizontalPodAutoscalerDetails, error) {
		return autoscaling.NewService(deps).HorizontalPodAutoscaler(namespace, name)
	})
}
