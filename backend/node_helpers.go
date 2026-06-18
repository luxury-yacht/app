/*
 * backend/resources_nodes.go
 *
 * App-level node resource wrappers.
 * - Exposes node detail and lifecycle operations.
 */

package backend

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/pods"
	kubectldrain "k8s.io/kubectl/pkg/drain"
)

func requireNodeActionTarget(action string, target ObjectActionTargetRef) error {
	if target.Group != "" || target.Version != "v1" || target.Kind != nodes.Identity.Kind {
		return errUnsupportedActionTarget(action, target, "/v1", nodes.Identity.Kind)
	}
	return requireObjectName(target.Name)
}
func (a *App) requireNodeMaintenancePermission(deps common.Dependencies, nodeName string) error {
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Version: "v1",
		Kind:    nodes.Identity.Kind,
		Name:    nodeName,
		Verb:    "get",
	}); err != nil {
		return err
	}
	return a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Version: "v1",
		Kind:    nodes.Identity.Kind,
		Name:    nodeName,
		Verb:    "patch",
	})
}
func (a *App) requireDrainPodPermission(deps common.Dependencies, options DrainNodeOptions) error {
	podCheck := resourcePermissionCheck{
		Version:     "v1",
		Kind:        pods.Identity.Kind,
		Verb:        "create",
		Subresource: "eviction",
	}
	if options.DisableEviction {
		podCheck = resourcePermissionCheck{Version: "v1", Kind: pods.Identity.Kind, Verb: "delete"}
	} else {
		evictionGroupVersion, err := kubectldrain.CheckEvictionSupport(deps.KubernetesClient)
		if err != nil {
			return fmt.Errorf("failed to check eviction support: %w", err)
		}
		if evictionGroupVersion.Empty() {
			podCheck = resourcePermissionCheck{Version: "v1", Kind: pods.Identity.Kind, Verb: "delete"}
		}
	}
	return a.requireResourcePermission(deps.Context, deps, podCheck)
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
		Target:      runtimeOperationTarget(job.ClusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", job.NodeName),
		Status:      string(job.Status),
		StartedAt:   time.UnixMilli(job.StartedAt).Format(time.RFC3339),
		DisplayName: fmt.Sprintf("Drain %s", job.NodeName),
		Summary: map[string]string{
			"nodeName": job.NodeName,
		},
	}
}
func (a *App) clearNodeCaches(selectionKey, nodeName string) {
	a.invalidateResponseCache(selectionKey, nodes.Identity.Kind, "", nodeName)
}
