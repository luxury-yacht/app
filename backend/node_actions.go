/*
 * backend/resources_nodes.go
 *
 * App-level node resource wrappers.
 * - Exposes node detail and lifecycle operations.
 */

package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
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
	if err := nodes.NewService(deps).Cordon(ctx, target.Name); err != nil {
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
	if err := nodes.NewService(deps).Uncordon(ctx, target.Name); err != nil {
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
	if err := nodes.NewService(deps).Drain(ctx, target.Name, options); err != nil {
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
	job, err := nodes.NewService(deps).StartDrainWithCompletion(ctx, target.Name, options, func(jobID string) {
		g.clearNodeCaches(selectionKey, target.Name)
		if g.operations != nil {
			g.operations.unregisterRuntimeOperation(jobID)
		}
	})
	if err != nil {
		return "", err
	}
	if !g.operations.registerDrainOperation(job, operationEpoch) {
		g.operations.drainStore.CancelDrainForClusterLifecycle(job.ID, job.ClusterID, "cluster disconnected")
		return "", fmt.Errorf("cluster disconnected before drain operation registered")
	}
	if current, ok := g.operations.drainStore.JobForCluster(job.ID, job.ClusterID); ok && current.Status != nodemaintenance.DrainStatusRunning && current.Status != nodemaintenance.DrainStatusCanceling {
		g.operations.unregisterRuntimeOperation(job.ID)
	}
	g.clearNodeCaches(selectionKey, target.Name)
	return job.ID, nil
}
func (o *OperationsCoordinator) registerDrainOperation(job *nodemaintenance.DrainJob, operationEpoch uint64) bool {
	if o == nil || job == nil {
		return false
	}
	return o.registerRuntimeOperationAtEpoch(runtimeOperationFromDrainJob(job), func(reason string) error {
		o.drainStore.CancelDrainForClusterLifecycle(job.ID, job.ClusterID, reason)
		return nil
	}, operationEpoch)
}

func (o *OperationsCoordinator) CancelDrainNodeJob(clusterID, jobID string) error {
	trimmedJobID := strings.TrimSpace(jobID)
	if trimmedJobID == "" {
		return fmt.Errorf("job ID is required")
	}
	if o == nil || o.clusterAccess == nil {
		return fmt.Errorf("cluster access not initialized")
	}
	deps, _, err := o.clusterAccess.ResolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	job, ok := o.drainStore.JobForCluster(trimmedJobID, deps.ClusterID)
	if !ok {
		return fmt.Errorf("drain job %s not found for cluster %s", trimmedJobID, deps.ClusterID)
	}
	ctx := o.operationContext()
	if err := o.permissions.Require(ctx, deps, OperationsPermissionCheck{
		Version: "v1",
		Kind:    nodes.Identity.Kind,
		Name:    job.NodeName,
		Verb:    "get",
	}); err != nil {
		return err
	}
	if err := o.permissions.Require(ctx, deps, OperationsPermissionCheck{
		Version: "v1",
		Kind:    nodes.Identity.Kind,
		Name:    job.NodeName,
		Verb:    "patch",
	}); err != nil {
		return err
	}
	return o.drainStore.CancelDrainForCluster(trimmedJobID, deps.ClusterID)
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
	if err := nodes.NewService(deps).Delete(ctx, target.Name, force); err != nil {
		return err
	}
	g.clearNodeCaches(selectionKey, target.Name)
	return nil
}
