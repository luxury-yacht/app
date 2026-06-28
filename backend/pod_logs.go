/*
 * backend/resources_pods.go
 *
 * App-level pod resource wrappers.
 * - Bridges Wails handlers to pod services.
 * - Resolves cluster-scoped dependencies for pod actions.
 */

package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/resources/pods"
)

func (a *App) FetchContainerLogs(clusterID string, req ContainerLogsFetchRequest) ContainerLogsFetchResponse {
	if err := requireMatchingContainerLogsScopeCluster(clusterID, req.Scope); err != nil {
		return ContainerLogsFetchResponse{Error: err.Error()}
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return ContainerLogsFetchResponse{Error: err.Error()}
	}
	service := pods.NewService(deps)
	return service.FetchContainerLogs(req)
}
func (a *App) GetPodContainers(clusterID, namespace, podName string) ([]string, error) {
	if err := requirePodObject(namespace, podName); err != nil {
		return nil, err
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	return service.PodContainers(namespace, podName)
}
func (a *App) GetContainerLogsScopeContainers(clusterID, scope string) ([]string, error) {
	if err := requireMatchingContainerLogsScopeCluster(clusterID, scope); err != nil {
		return nil, err
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	return service.ContainerLogsScopeContainers(scope)
}

func requireMatchingContainerLogsScopeCluster(clusterID, scope string) error {
	if strings.TrimSpace(scope) == "" {
		return fmt.Errorf("container logs scope is required")
	}
	clusterIDs, _ := refresh.SplitClusterScopeList(scope)
	if len(clusterIDs) != 1 {
		return fmt.Errorf("container logs scope requires a single cluster scope")
	}
	requestedClusterID := strings.TrimSpace(clusterID)
	scopeClusterID := strings.TrimSpace(clusterIDs[0])
	if scopeClusterID != requestedClusterID {
		return fmt.Errorf("container logs scope cluster %q does not match requested cluster %q", scopeClusterID, requestedClusterID)
	}
	return nil
}
