package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// This file holds former production entry points that now exist only for
// tests: each routes into the live dispatch/internal paths (RunObjectAction,
// the *Internal action workers, the session registries, or the typed fetch
// helpers), and every production caller has moved to those paths directly.
// Keeping them in test scope preserves the tests' coverage of the live
// behavior without carrying unreachable methods on the production App surface.

func objectActionTargetFromGVK(clusterID string, gvk schema.GroupVersionKind, namespace, name string) ObjectActionTargetRef {
	return objectActionTarget(clusterID, gvk.Group, gvk.Version, gvk.Kind, namespace, name)
}

// restartWorkload performs a rollout restart by patching the pod template metadata on the target workload.
// Supported workload kinds: Deployment, StatefulSet, DaemonSet.
func (g *ResourceGateway) restartWorkload(clusterID, namespace, group, version, workloadKind, name string) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionRestart,
		Target: objectActionTarget(
			clusterID,
			group,
			version,
			workloadKind,
			namespace,
			name,
		),
	})
	return err
}

// scaleWorkload updates the replica count on a scalable workload.
// Supported workload kinds: Deployment, StatefulSet, ReplicaSet.
func (g *ResourceGateway) scaleWorkload(clusterID, namespace, group, version, workloadKind, name string, replicas int) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	if replicas < 0 {
		return fmt.Errorf("replicas must be non-negative")
	}
	if replicas > maxScaleReplicas {
		return fmt.Errorf("replicas must be less than or equal to %d", maxScaleReplicas)
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionScale,
		Target: objectActionTarget(
			clusterID,
			group,
			version,
			workloadKind,
			namespace,
			name,
		),
		Replicas: &replicas,
	})
	return err
}

// triggerCronJob creates a Job immediately from a CronJob's jobTemplate spec.
// Returns the name of the created Job on success.
func (g *ResourceGateway) triggerCronJob(clusterID, namespace, name string) (string, error) {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return "", err
	}
	resp, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionTrigger,
		Target: objectActionTarget(
			clusterID,
			cronjob.Identity.Group,
			cronjob.Identity.Version,
			cronjob.Identity.Kind,
			namespace,
			name,
		),
	})
	return resp.Name, err
}

// suspendCronJob sets the suspend field on a CronJob.
// When suspended, the CronJob will not create new Jobs on schedule.
func (g *ResourceGateway) suspendCronJob(clusterID, namespace, name string, suspend bool) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionSuspend,
		Target: objectActionTarget(
			clusterID,
			cronjob.Identity.Group,
			cronjob.Identity.Version,
			cronjob.Identity.Kind,
			namespace,
			name,
		),
		Suspend: &suspend,
	})
	return err
}

// rollbackWorkload rolls a workload back to a specific historical revision by replacing
// its pod template spec with the one stored in that revision.
//
// The target revision is located by calling GetRevisionHistory. If no entry matches
// toRevision, an error is returned. Supports Deployment, StatefulSet, and DaemonSet.
//
// Multi-cluster safety: all Kubernetes requests are scoped to the cluster identified
// by clusterID, preventing cross-cluster data leakage or modification.
func (g *ResourceGateway) rollbackWorkload(clusterID, namespace, group, version, workloadKind, name string, toRevision int64) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionRollback,
		Target: objectActionTarget(
			clusterID,
			group,
			version,
			workloadKind,
			namespace,
			name,
		),
		Revision: &toRevision,
	})
	return err
}

func (g *ResourceGateway) deletePod(clusterID, namespace, name string) error {
	if err := requirePodObject(namespace, name); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(
			clusterID,
			"",
			"v1",
			pods.Identity.Kind,
			namespace,
			name,
		),
	})
	return err
}

// createDebugContainer adds an ephemeral debug container to a running pod.
func (g *ResourceGateway) createDebugContainer(clusterID string, req DebugContainerRequest) (*DebugContainerResponse, error) {
	if err := requirePodObject(req.Namespace, req.PodName); err != nil {
		return nil, err
	}
	resp, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionCreateDebugContainer,
		Target: objectActionTarget(
			clusterID,
			"",
			"v1",
			pods.Identity.Kind,
			req.Namespace,
			req.PodName,
		),
		DebugContainer: &ObjectActionDebugContainerOptions{
			Image:           req.Image,
			TargetContainer: req.TargetContainer,
		},
	})
	if err != nil {
		return nil, err
	}
	return resp.DebugContainer, nil
}

func (g *ResourceGateway) cordonNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionCordon,
		Target: objectActionTarget(clusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", nodeName),
	})
	return err
}

func (g *ResourceGateway) uncordonNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionUncordon,
		Target: objectActionTarget(clusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", nodeName),
	})
	return err
}

func (g *ResourceGateway) drainNode(clusterID, nodeName string, options DrainNodeOptions) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action:       ObjectActionDrain,
		Target:       objectActionTarget(clusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", nodeName),
		DrainOptions: &options,
	})
	return err
}

func (g *ResourceGateway) deleteNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(clusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", nodeName),
	})
	return err
}

func (g *ResourceGateway) forceDeleteNode(clusterID, nodeName string) error {
	if err := requireObjectName(nodeName); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionForceDelete,
		Target: objectActionTarget(clusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", nodeName),
	})
	return err
}

func (g *ResourceGateway) deleteHelmRelease(clusterID, namespace, name string) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(
			clusterID,
			"helm.sh",
			"v3",
			"HelmRelease",
			namespace,
			name,
		),
	})
	return err
}

// deleteResourceByGVK removes a Kubernetes object identified by its
// fully-qualified apiVersion + kind. apiVersion must be in the standard
// Kubernetes "group/version" form (or just "version" for core resources
// like "v1"). Unlike DeleteResource, this path resolves the GVR strictly
// through the cluster's resource resolver so two CRDs that share a Kind don't
// get conflated.
func (g *ResourceGateway) deleteResourceByGVK(clusterID, apiVersion, kind, namespace, name string) error {
	gvk := schema.FromAPIVersionAndKind(strings.TrimSpace(apiVersion), strings.TrimSpace(kind))
	if gvk.Kind == "" {
		return fmt.Errorf("kind is required")
	}
	if gvk.Version == "" {
		return fmt.Errorf("apiVersion is required")
	}
	if err := requireObjectName(name); err != nil {
		return err
	}
	_, err := g.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTargetFromGVK(clusterID, gvk, namespace, name),
	})
	return err
}

func (g *ResourceGateway) getGVRForGVK(ctx context.Context, clusterID string, gvk schema.GroupVersionKind) (schema.GroupVersionResource, bool, error) {
	deps, selectionKey, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return schema.GroupVersionResource{}, false, err
	}
	return getGVRForGVKWithDependencies(ctx, deps, selectionKey, gvk)
}

// startPortForward initiates a new port forwarding session to a Kubernetes pod.
// For workloads (Deployment, StatefulSet, DaemonSet) and Services, the session
// will automatically reconnect if the underlying pod is replaced.
func (o *OperationsCoordinator) startPortForward(clusterID string, req PortForwardRequest) (string, error) {
	return o.startPortForwardAction(
		objectActionTarget(
			clusterID,
			req.TargetGroup,
			req.TargetVersion,
			req.TargetKind,
			req.Namespace,
			req.TargetName,
		), ObjectActionPortForwardOptions{
			ContainerPort: req.ContainerPort,
			LocalPort:     req.LocalPort,
		},
	)
}

func (o *OperationsCoordinator) stopPortForwardForRuntime(sessionID, reason string) error {
	return o.portForwardLifecycle().stopForRuntime(sessionID, reason)
}

func (o *OperationsCoordinator) closeShellSessionForRuntime(sessionID, reason string) error {
	return o.shellSessionLifecycle().closeForRuntime(sessionID, reason)
}

// invalidateResponseCacheForObject clears cached detail/YAML/helm data for the given resource.
func (g *ResourceGateway) invalidateResponseCacheForObject(selectionKey string, identity resourcekind.Identity, obj interface{}) {
	g.invalidateResponseCacheForObjectEvent(
		selectionKey,
		identity,
		obj,
		responseCacheInvalidationUpdate,
		responseCacheInvalidationGuard{},
	)
}

// FetchResource executes the supplied fetch function, wrapping any error with
// additional diagnostic information. It uses a short-lived response cache for
// non-informer GETs to avoid repeated requests for the same resource.
func FetchResource[T any](
	g *ResourceGateway,
	cacheKey string,
	resourceKind string,
	identifier string,
	fetchFunc func() (T, error),
) (T, error) {
	return FetchResourceWithSelection(g, "", cacheKey, resourceKind, identifier, func(context.Context) (T, error) {
		return fetchFunc()
	})
}

// FetchResourceList executes a list fetch function for a given resource kind
// and namespace. No caching is performed.
func FetchResourceList[T any](
	g *ResourceGateway,
	clusterID string,
	resourceKind string,
	namespace string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	scope := "cluster"
	if namespace != "" {
		scope = fmt.Sprintf("namespace %s", namespace)
	}

	ctx := g.CtxOrBackground()
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, config.ResourceFetchCallTimeout)
		defer cancel()
	}

	result, err := executeWithRetry(ctx, g.resourceRetryDependencies(), clusterID, resourceKind, scope, func(context.Context) (T, error) {
		return fetchFunc()
	})
	if err != nil {
		g.logger.Error(fmt.Sprintf("Failed to list %s in %s: %v", resourceKind, scope, err), logsources.ResourceLoader, clusterID, g.clusterNameForID(clusterID))
		// Include clusterId in error payload so frontend can identify which cluster
		// the error belongs to.
		g.emitEvent(backendErrorEventName, BackendErrorEvent{
			ClusterID:    clusterID,
			ResourceKind: resourceKind,
			Identifier:   scope,
			Message:      err.Error(),
			Error:        fmt.Sprintf("%v", err),
		})
		return zero, errorcapture.Enhance(err)
	}

	return result, nil
}
