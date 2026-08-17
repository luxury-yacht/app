package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/nodes"
)

func (o *OperationsCoordinator) cancelDrainForClusterLifecycle(jobID, clusterID, reason string) {
	if o != nil && o.drainStore != nil {
		o.drainStore.CancelDrainForClusterLifecycle(jobID, clusterID, reason)
	}
}

func (o *OperationsCoordinator) drainOperationFinished(jobID, clusterID string) bool {
	if o == nil || o.drainStore == nil {
		return false
	}
	current, ok := o.drainStore.JobForCluster(jobID, clusterID)
	return ok && current.Status != nodemaintenance.DrainStatusRunning && current.Status != nodemaintenance.DrainStatusCanceling
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
