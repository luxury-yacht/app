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

func (g *ResourceGateway) DiscoverNodeLogs(clusterID, nodeName string) NodeLogDiscoveryResponse {
	if err := requireObjectName(nodeName); err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	deps, _, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	ctx := g.CtxOrBackground()
	if err := g.requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Version:     "v1",
		Kind:        nodes.Identity.Kind,
		Name:        nodeName,
		Verb:        "get",
		Subresource: "proxy",
	}); err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	return nodes.NewService(deps).DiscoverLogs(ctx, nodeName)
}
func (g *ResourceGateway) FetchNodeLogs(clusterID, nodeName string, req NodeLogFetchRequest) NodeLogFetchResponse {
	if err := requireObjectName(nodeName); err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	deps, _, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	ctx := g.CtxOrBackground()
	if err := g.requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Version:     "v1",
		Kind:        nodes.Identity.Kind,
		Name:        nodeName,
		Verb:        "get",
		Subresource: "proxy",
	}); err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	return nodes.NewService(deps).FetchLogs(ctx, nodeName, req)
}
