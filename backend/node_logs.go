/*
 * backend/resources_nodes.go
 *
 * App-level node resource wrappers.
 * - Exposes node detail and lifecycle operations.
 */

package backend

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/nodes"
)

func (g *ResourceGateway) DiscoverNodeLogs(target resourcemodel.ResourceRef) NodeLogDiscoveryResponse {
	if err := requireNodeLogTarget(target); err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	nodeName := target.Name
	deps, _, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	ctx := g.CtxOrBackground()
	if err := requireResourcePermission(ctx, deps, resourcePermissionCheck{
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
func (g *ResourceGateway) FetchNodeLogs(target resourcemodel.ResourceRef, req NodeLogFetchRequest) (NodeLogFetchResponse, error) {
	if err := requireNodeLogTarget(target); err != nil {
		return NodeLogFetchResponse{}, err
	}
	nodeName := target.Name
	deps, _, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return NodeLogFetchResponse{}, err
	}
	ctx := g.CtxOrBackground()
	if err := requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Version:     "v1",
		Kind:        nodes.Identity.Kind,
		Name:        nodeName,
		Verb:        "get",
		Subresource: "proxy",
	}); err != nil {
		return NodeLogFetchResponse{}, err
	}
	return nodes.NewService(deps).FetchLogs(ctx, nodeName, req)
}

// requireNodeLogTarget accepts only a named core/v1 Node.
func requireNodeLogTarget(target resourcemodel.ResourceRef) error {
	if err := requireTargetIdentity(target, nodes.Identity); err != nil {
		return err
	}
	return requireObjectName(target.Name)
}
