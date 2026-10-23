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

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/pods"
)

// containerLogTargets is the kind registry's container-log target table, the one
// the log stream reads through too (refresh/system/streams.go).
var containerLogTargets = kindregistry.MustLogTargets()

func (g *ResourceGateway) FetchContainerLogs(clusterID string, req ContainerLogsFetchRequest) (ContainerLogsFetchResponse, error) {
	if err := requireMatchingContainerLogsScopeCluster(clusterID, req.Scope); err != nil {
		return ContainerLogsFetchResponse{}, err
	}
	deps, _, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return ContainerLogsFetchResponse{}, err
	}
	service := pods.NewContainerLogsService(deps, containerLogTargets)
	// No budget for the whole call: each container's read has its own timeout,
	// and a shared one would fail the containers read last.
	return service.FetchContainerLogs(g.CtxOrBackground(), req)
}
func (g *ResourceGateway) GetPodContainers(target resourcemodel.ResourceRef) ([]PodContainer, error) {
	if err := requireTargetIdentity(target, pods.Identity); err != nil {
		return nil, err
	}
	if err := requirePodObject(target.Namespace, target.Name); err != nil {
		return nil, err
	}
	deps, _, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	return service.PodContainers(g.CtxOrBackground(), target.Namespace, target.Name)
}
func (g *ResourceGateway) GetContainerLogsScopeContainers(clusterID, scope string) ([]PodContainer, error) {
	if err := requireMatchingContainerLogsScopeCluster(clusterID, scope); err != nil {
		return nil, err
	}
	deps, _, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewContainerLogsService(deps, containerLogTargets)
	return service.ContainerLogsScopeContainers(g.CtxOrBackground(), scope)
}

func requireMatchingContainerLogsScopeCluster(clusterID, scope string) error {
	if strings.TrimSpace(scope) == "" {
		return errorstatus.BadRequest(fmt.Errorf("container logs scope is required"))
	}
	scopeClusterID, _ := refresh.SplitClusterScope(scope)
	if scopeClusterID == "" {
		return errorstatus.BadRequest(fmt.Errorf("container logs scope requires a cluster scope"))
	}
	requestedClusterID := strings.TrimSpace(clusterID)
	if scopeClusterID != requestedClusterID {
		return errorstatus.BadRequest(fmt.Errorf("container logs scope cluster %q does not match requested cluster %q", scopeClusterID, requestedClusterID))
	}
	return nil
}
