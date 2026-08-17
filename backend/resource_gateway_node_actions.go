package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/nodes"
)

func (g *ResourceGateway) cordonNodeAction(target ObjectActionTargetRef) error {
	if err := requireNodeActionTarget(ObjectActionCordon, target); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	if err := g.requireNodeMaintenancePermission(ctx, deps, target.Name); err != nil {
		return err
	}
	if err := nodes.NewService(deps, g.nodeMaintenanceStore).Cordon(ctx, target.Name); err != nil {
		return err
	}
	g.clearNodeCaches(selectionKey, target.Name)
	return nil
}

func (g *ResourceGateway) uncordonNodeAction(target ObjectActionTargetRef) error {
	if err := requireNodeActionTarget(ObjectActionUncordon, target); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	if err := g.requireNodeMaintenancePermission(ctx, deps, target.Name); err != nil {
		return err
	}
	if err := nodes.NewService(deps, g.nodeMaintenanceStore).Uncordon(ctx, target.Name); err != nil {
		return err
	}
	g.clearNodeCaches(selectionKey, target.Name)
	return nil
}

func (g *ResourceGateway) drainNodeAction(target ObjectActionTargetRef, options DrainNodeOptions) error {
	if err := requireNodeActionTarget(ObjectActionDrain, target); err != nil {
		return err
	}
	if err := nodes.ValidateDrainOptions(options); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	if err := g.requireNodeMaintenancePermission(ctx, deps, target.Name); err != nil {
		return err
	}
	if err := g.requireDrainPodPermission(ctx, deps, options); err != nil {
		return err
	}
	if err := nodes.NewService(deps, g.nodeMaintenanceStore).Drain(ctx, target.Name, options); err != nil {
		return err
	}
	g.clearNodeCaches(selectionKey, target.Name)
	return nil
}

func (g *ResourceGateway) startDrainNodeAction(target ObjectActionTargetRef, options DrainNodeOptions) (string, error) {
	if err := requireNodeActionTarget(ObjectActionStartDrain, target); err != nil {
		return "", err
	}
	if err := nodes.ValidateDrainOptions(options); err != nil {
		return "", err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return "", err
	}
	ctx := g.CtxOrBackground()
	if err := g.requireNodeMaintenancePermission(ctx, deps, target.Name); err != nil {
		return "", err
	}
	if err := g.requireDrainPodPermission(ctx, deps, options); err != nil {
		return "", err
	}
	if g.operations == nil {
		return "", fmt.Errorf("operations coordinator not initialized")
	}
	operationEpoch := g.operations.clusterOperationEpoch(target.ClusterID)
	job, err := nodes.NewService(deps, g.nodeMaintenanceStore).StartDrainWithCompletion(ctx, target.Name, options, func(jobID string) {
		g.clearNodeCaches(selectionKey, target.Name)
		if g.operations != nil {
			g.operations.unregisterRuntimeOperation(jobID)
		}
	})
	if err != nil {
		return "", err
	}
	if !g.operations.registerDrainOperation(job, operationEpoch) {
		g.operations.cancelDrainForClusterLifecycle(job.ID, job.ClusterID, "cluster disconnected")
		return "", fmt.Errorf("cluster disconnected before drain operation registered")
	}
	if g.operations.drainOperationFinished(job.ID, job.ClusterID) {
		g.operations.unregisterRuntimeOperation(job.ID)
	}
	g.clearNodeCaches(selectionKey, target.Name)
	return job.ID, nil
}

func (g *ResourceGateway) deleteNodeAction(target ObjectActionTargetRef, force bool) error {
	if err := requireNodeActionTarget(ObjectActionDelete, target); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	if err := g.requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:   target.Group,
		Version: target.Version,
		Kind:    target.Kind,
		Name:    target.Name,
		Verb:    "delete",
	}); err != nil {
		return err
	}
	if err := nodes.NewService(deps, g.nodeMaintenanceStore).Delete(ctx, target.Name, force); err != nil {
		return err
	}
	g.clearNodeCaches(selectionKey, target.Name)
	return nil
}
