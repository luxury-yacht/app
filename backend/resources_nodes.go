package backend

import "github.com/luxury-yacht/app/backend/resources/nodes"

func (a *App) GetNode(name string) (*NodeDetails, error) {
	deps := nodes.Dependencies{Common: a.resourceDependencies()}
	return FetchClusterResource(a, "Node", name, func() (*NodeDetails, error) {
		return nodes.NewService(deps).Node(name)
	})
}

func (a *App) CordonNode(clusterID, nodeName string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := nodes.NewService(nodes.Dependencies{Common: deps}).Cordon(nodeName); err != nil {
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
	if err := nodes.NewService(nodes.Dependencies{Common: deps}).Uncordon(nodeName); err != nil {
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
	if err := nodes.NewService(nodes.Dependencies{Common: deps}).Drain(nodeName, options); err != nil {
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
	if err := nodes.NewService(nodes.Dependencies{Common: deps}).Delete(nodeName, false); err != nil {
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
	if err := nodes.NewService(nodes.Dependencies{Common: deps}).Delete(nodeName, true); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) clearNodeCaches(nodeName string) {
	_ = nodeName
}
