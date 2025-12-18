package backend

import "github.com/luxury-yacht/app/backend/resources/nodes"

func (a *App) GetNode(name string) (*NodeDetails, error) {
	deps := nodes.Dependencies{Common: a.resourceDependencies()}
	return FetchClusterResource(a, "Node", name, func() (*NodeDetails, error) {
		return nodes.NewService(deps).Node(name)
	})
}

func (a *App) CordonNode(nodeName string) error {
	deps := nodes.Dependencies{Common: a.resourceDependencies()}
	if err := nodes.NewService(deps).Cordon(nodeName); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) UncordonNode(nodeName string) error {
	deps := nodes.Dependencies{Common: a.resourceDependencies()}
	if err := nodes.NewService(deps).Uncordon(nodeName); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) DrainNode(nodeName string, options DrainNodeOptions) error {
	deps := nodes.Dependencies{Common: a.resourceDependencies()}
	if err := nodes.NewService(deps).Drain(nodeName, options); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) DeleteNode(nodeName string) error {
	deps := nodes.Dependencies{Common: a.resourceDependencies()}
	if err := nodes.NewService(deps).Delete(nodeName, false); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) ForceDeleteNode(nodeName string) error {
	deps := nodes.Dependencies{Common: a.resourceDependencies()}
	if err := nodes.NewService(deps).Delete(nodeName, true); err != nil {
		return err
	}
	a.clearNodeCaches(nodeName)
	return nil
}

func (a *App) clearNodeCaches(nodeName string) {
	_ = nodeName
}
