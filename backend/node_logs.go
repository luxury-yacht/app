/*
 * backend/resources_nodes.go
 *
 * App-level node resource wrappers.
 * - Exposes node detail and lifecycle operations.
 */

package backend

import (
	"github.com/luxury-yacht/app/backend/resources/nodes"
)

func (a *App) DiscoverNodeLogs(clusterID, nodeName string) NodeLogDiscoveryResponse {
	if err := requireObjectName(nodeName); err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Version:     "v1",
		Kind:        nodes.Identity.Kind,
		Name:        nodeName,
		Verb:        "get",
		Subresource: "proxy",
	}); err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	return nodes.NewService(deps).DiscoverLogs(nodeName)
}
func (a *App) FetchNodeLogs(clusterID, nodeName string, req NodeLogFetchRequest) NodeLogFetchResponse {
	if err := requireObjectName(nodeName); err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Version:     "v1",
		Kind:        nodes.Identity.Kind,
		Name:        nodeName,
		Verb:        "get",
		Subresource: "proxy",
	}); err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	return nodes.NewService(deps).FetchLogs(nodeName, req)
}
