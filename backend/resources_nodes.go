/*
 * backend/resources_nodes.go
 *
 * App-level node resource wrappers.
 * - Exposes node detail and lifecycle operations.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/nodes"

func (a *App) GetNode(clusterID, name string) (*NodeDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "Node", name, func() (*NodeDetails, error) {
		return nodes.NewService(deps).Node(name)
	})
}

func (a *App) CordonNode(clusterID, nodeName string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := nodes.NewService(deps).Cordon(nodeName); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) UncordonNode(clusterID, nodeName string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := nodes.NewService(deps).Uncordon(nodeName); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) DrainNode(clusterID, nodeName string, options DrainNodeOptions) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := nodes.NewService(deps).Drain(nodeName, options); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) DeleteNode(clusterID, nodeName string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := nodes.NewService(deps).Delete(nodeName, false); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) ForceDeleteNode(clusterID, nodeName string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := nodes.NewService(deps).Delete(nodeName, true); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) clearNodeCaches(nodeName string) {
	_ = nodeName
}

func (a *App) DiscoverNodeLogs(clusterID, nodeName string) NodeLogDiscoveryResponse {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	return nodes.NewService(deps).DiscoverLogs(nodeName)
}

func (a *App) FetchNodeLogs(clusterID, nodeName string, req NodeLogFetchRequest) NodeLogFetchResponse {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	return nodes.NewService(deps).FetchLogs(nodeName, req)
}
