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

func (a *App) cordonNodeAction(target ObjectActionTargetRef) error {
	if err := requireNodeActionTarget(ObjectActionCordon, target); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if err := a.requireNodeMaintenancePermission(deps, target.Name); err != nil {
		return err
	}
	if err := nodes.NewService(deps).Cordon(target.Name); err != nil {
		return err
	}
	a.clearNodeCaches(selectionKey, target.Name)
	return nil
}
func (a *App) uncordonNodeAction(target ObjectActionTargetRef) error {
	if err := requireNodeActionTarget(ObjectActionUncordon, target); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if err := a.requireNodeMaintenancePermission(deps, target.Name); err != nil {
		return err
	}
	if err := nodes.NewService(deps).Uncordon(target.Name); err != nil {
		return err
	}
	a.clearNodeCaches(selectionKey, target.Name)
	return nil
}
func (a *App) drainNodeAction(target ObjectActionTargetRef, options DrainNodeOptions) error {
	if err := requireNodeActionTarget(ObjectActionDrain, target); err != nil {
		return err
	}
	if err := nodes.ValidateDrainOptions(options); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if err := a.requireNodeMaintenancePermission(deps, target.Name); err != nil {
		return err
	}
	if err := a.requireDrainPodPermission(deps, options); err != nil {
		return err
	}
	if err := nodes.NewService(deps).Drain(target.Name, options); err != nil {
		return err
	}
	a.clearNodeCaches(selectionKey, target.Name)
	return nil
}
func (a *App) startDrainNodeAction(target ObjectActionTargetRef, options DrainNodeOptions) (string, error) {
	if err := requireNodeActionTarget(ObjectActionStartDrain, target); err != nil {
		return "", err
	}
	if err := nodes.ValidateDrainOptions(options); err != nil {
		return "", err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return "", err
	}
	if err := a.requireNodeMaintenancePermission(deps, target.Name); err != nil {
		return "", err
	}
	if err := a.requireDrainPodPermission(deps, options); err != nil {
		return "", err
	}
	job, err := nodes.NewService(deps).StartDrainWithCompletion(target.Name, options, func(jobID string) {
		a.clearNodeCaches(selectionKey, target.Name)
		a.unregisterRuntimeOperation(jobID)
	})
	if err != nil {
		return "", err
	}
	a.registerRuntimeOperation(runtimeOperationFromDrainJob(job), func(reason string) error {
		nodemaintenance.GlobalStore().CancelDrainForClusterLifecycle(job.ID, deps.ClusterID, reason)
		return nil
	})
	a.clearNodeCaches(selectionKey, target.Name)
	return job.ID, nil
}
func (a *App) CancelDrainNodeJob(clusterID, jobID string) error {
	trimmedJobID := strings.TrimSpace(jobID)
	if trimmedJobID == "" {
		return fmt.Errorf("job ID is required")
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	store := nodemaintenance.GlobalStore()
	job, ok := store.JobForCluster(trimmedJobID, deps.ClusterID)
	if !ok {
		return fmt.Errorf("drain job %s not found for cluster %s", trimmedJobID, deps.ClusterID)
	}
	if err := a.requireNodeMaintenancePermission(deps, job.NodeName); err != nil {
		return err
	}
	return store.CancelDrainForCluster(trimmedJobID, deps.ClusterID)
}
func (a *App) deleteNodeAction(target ObjectActionTargetRef, force bool) error {
	if err := requireNodeActionTarget(ObjectActionDelete, target); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Group:   target.Group,
		Version: target.Version,
		Kind:    target.Kind,
		Name:    target.Name,
		Verb:    "delete",
	}); err != nil {
		return err
	}
	if err := nodes.NewService(deps).Delete(target.Name, force); err != nil {
		return err
	}
	a.clearNodeCaches(selectionKey, target.Name)
	return nil
}
