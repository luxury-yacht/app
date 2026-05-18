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
	"time"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	kubectldrain "k8s.io/kubectl/pkg/drain"
)

func (a *App) GetNode(clusterID, name string) (*NodeDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "Node", name, func() (*NodeDetails, error) {
		return nodes.NewService(deps).Node(name)
	})
}

func (a *App) cordonNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionCordon,
		Target: objectActionTarget(clusterID, "", "v1", "Node", "", nodeName),
	})
	return err
}

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

func (a *App) uncordonNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionUncordon,
		Target: objectActionTarget(clusterID, "", "v1", "Node", "", nodeName),
	})
	return err
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

func (a *App) drainNode(clusterID, nodeName string, options DrainNodeOptions) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action:       ObjectActionDrain,
		Target:       objectActionTarget(clusterID, "", "v1", "Node", "", nodeName),
		DrainOptions: &options,
	})
	return err
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
		nodemaintenance.GlobalStore().CancelActiveDrainsForClusterLifecycle(deps.ClusterID, reason)
		return nil
	})
	a.clearNodeCaches(selectionKey, target.Name)
	return job.ID, nil
}

func requireNodeActionTarget(action string, target ObjectActionTargetRef) error {
	if target.Group != "" || target.Version != "v1" || target.Kind != "Node" {
		return errUnsupportedActionTarget(action, target, "/v1", "Node")
	}
	return requireObjectName(target.Name)
}

func (a *App) requireNodeMaintenancePermission(deps common.Dependencies, nodeName string) error {
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Kind: "Node",
		Name: nodeName,
		Verb: "get",
	}); err != nil {
		return err
	}
	return a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Kind: "Node",
		Name: nodeName,
		Verb: "patch",
	})
}

func (a *App) requireDrainPodPermission(deps common.Dependencies, options DrainNodeOptions) error {
	podCheck := resourcePermissionCheck{
		Kind:        "Pod",
		Verb:        "create",
		Subresource: "eviction",
	}
	if options.DisableEviction {
		podCheck = resourcePermissionCheck{Kind: "Pod", Verb: "delete"}
	} else {
		evictionGroupVersion, err := kubectldrain.CheckEvictionSupport(deps.KubernetesClient)
		if err != nil {
			return fmt.Errorf("failed to check eviction support: %w", err)
		}
		if evictionGroupVersion.Empty() {
			podCheck = resourcePermissionCheck{Kind: "Pod", Verb: "delete"}
		}
	}
	return a.requireResourcePermission(deps.Context, deps, podCheck)
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

func runtimeOperationFromDrainJob(job *nodemaintenance.DrainJob) RuntimeOperation {
	if job == nil {
		return RuntimeOperation{}
	}
	return RuntimeOperation{
		ID:          job.ID,
		Type:        RuntimeOperationDrain,
		ClusterID:   job.ClusterID,
		ClusterName: job.ClusterName,
		Target:      runtimeOperationTarget(job.ClusterID, "", "v1", "Node", "", job.NodeName),
		Status:      string(job.Status),
		StartedAt:   time.UnixMilli(job.StartedAt).Format(time.RFC3339),
		DisplayName: fmt.Sprintf("Drain %s", job.NodeName),
		Summary: map[string]string{
			"nodeName": job.NodeName,
		},
	}
}

func (a *App) deleteNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(clusterID, "", "v1", "Node", "", nodeName),
	})
	return err
}

func (a *App) forceDeleteNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionForceDelete,
		Target: objectActionTarget(clusterID, "", "v1", "Node", "", nodeName),
	})
	return err
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

func (a *App) clearNodeCaches(selectionKey, nodeName string) {
	a.invalidateResponseCache(selectionKey, "Node", "", nodeName)
}

func (a *App) DiscoverNodeLogs(clusterID, nodeName string) NodeLogDiscoveryResponse {
	if err := requireObjectName(nodeName); err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return NodeLogDiscoveryResponse{Reason: err.Error()}
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Kind:        "Node",
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
		Kind:        "Node",
		Name:        nodeName,
		Verb:        "get",
		Subresource: "proxy",
	}); err != nil {
		return NodeLogFetchResponse{Error: err.Error(), SourcePath: req.SourcePath}
	}
	return nodes.NewService(deps).FetchLogs(nodeName, req)
}
