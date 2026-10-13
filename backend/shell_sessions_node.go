package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	podspkg "github.com/luxury-yacht/app/backend/resources/pods"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StartNodeShellSession is `kubectl debug node/<name> --profile=sysadmin -it`:
// it creates a privileged debug pod on the node with the user's credentials,
// waits for it to run, and attaches a terminal to it. The session targets the
// Node, and ending it by any path deletes the debug pod.
func (o *OperationsCoordinator) StartNodeShellSession(req NodeShellSessionRequest) (*ShellSession, error) {
	operationEpoch := o.clusterOperationEpoch(req.Target.ClusterID)
	launch, err := o.prepareNodeShellLaunch(req)
	if err != nil {
		return nil, shellStartError(req.Target, err)
	}
	return o.openShellSession(launch, operationEpoch)
}

func (o *OperationsCoordinator) prepareNodeShellLaunch(req NodeShellSessionRequest) (shellLaunch, error) {
	image, err := validateNodeShellRequest(req)
	if err != nil {
		return shellLaunch{}, err
	}
	clusterID := req.Target.ClusterID
	deps, err := o.resolveShellDependencies(clusterID)
	if err != nil {
		return shellLaunch{}, err
	}

	ctx, cancel := context.WithTimeout(o.operationContext(), config.ShellSessionShutdownTimeout)
	defer cancel()
	// Like kubectl, resolve the node first: a pod bound to a missing node would
	// wait until the start timeout instead of failing.
	if _, err := deps.KubernetesClient.CoreV1().Nodes().Get(ctx, req.Target.Name, metav1.GetOptions{}); err != nil {
		return shellLaunch{}, fmt.Errorf("failed to load node: %w", err)
	}
	if err := o.requireNodeShellPermissions(ctx, deps); err != nil {
		return shellLaunch{}, err
	}

	service := nodes.NewService(deps)
	pod, err := service.CreateDebugPod(ctx, req.Target.Name, image, req.Command)
	if err != nil {
		return shellLaunch{}, err
	}
	cleanup := o.nodeDebugPodCleanup(service, clusterID, pod)
	launch, err := o.attachNodeDebugPod(deps, req, pod)
	if err != nil {
		cleanup()
		return shellLaunch{}, err
	}
	launch.cleanup = cleanup
	return launch, nil
}

func validateNodeShellRequest(req NodeShellSessionRequest) (string, error) {
	if err := requireTargetIdentity(req.Target, nodes.Identity); err != nil {
		return "", err
	}
	if err := requireObjectName(req.Target.Name); err != nil {
		return "", err
	}
	image := strings.TrimSpace(req.Image)
	if image == "" {
		return "", errorstatus.BadRequest(fmt.Errorf("image is required"))
	}
	return image, nil
}

// requireNodeShellPermissions checks every pod operation the node shell needs
// in the debug namespace, including the delete that cleans the pod up, before
// anything is created.
func (o *OperationsCoordinator) requireNodeShellPermissions(ctx context.Context, deps common.Dependencies) error {
	podCheck := func(verb, subresource string) OperationsPermissionCheck {
		return OperationsPermissionCheck{
			Version:     podspkg.Identity.Version,
			Kind:        podspkg.Identity.Kind,
			Namespace:   nodes.DebugPodNamespace,
			Verb:        verb,
			Subresource: subresource,
		}
	}
	for _, check := range []OperationsPermissionCheck{podCheck("create", ""), podCheck("get", ""), podCheck("delete", "")} {
		if err := o.permissions.Require(ctx, deps, check); err != nil {
			return err
		}
	}
	// Websocket attach upgrades a GET and SPDY a POST, as for exec.
	return o.permissions.RequireAny(ctx, deps, podCheck("get", "attach"), podCheck("create", "attach"))
}

// attachNodeDebugPod waits for the debug pod's debugger container and builds
// the attach stream to it.
func (o *OperationsCoordinator) attachNodeDebugPod(deps common.Dependencies, req NodeShellSessionRequest, pod *corev1.Pod) (shellLaunch, error) {
	if err := nodes.NewService(deps).WaitForDebugPod(o.operationContext(), pod.Namespace, pod.Name); err != nil {
		return shellLaunch{}, err
	}
	executor, err := o.buildShellExecutor(deps, pod.Namespace, pod.Name, "attach", &corev1.PodAttachOptions{
		Container: nodes.DebugPodContainerName,
		Stdin:     true,
		Stdout:    true,
		Stderr:    true,
		TTY:       true,
	})
	if err != nil {
		return shellLaunch{}, err
	}
	clusterID := req.Target.ClusterID
	return shellLaunch{
		deps:      deps,
		target:    *runtimeOperationTarget(clusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", req.Target.Name),
		pod:       pod,
		container: nodes.DebugPodContainerName,
		command:   append([]string(nil), req.Command...),
		executor:  executor,
		debugPod:  runtimeOperationTarget(clusterID, podspkg.Identity.Group, podspkg.Identity.Version, podspkg.Identity.Kind, pod.Namespace, pod.Name),
	}, nil
}

// nodeDebugPodCleanup deletes the debug pod when its session closes. During
// app shutdown the operation context is already cancelled, so the delete gets
// its own bounded context.
func (o *OperationsCoordinator) nodeDebugPodCleanup(service *nodes.Service, clusterID string, pod *corev1.Pod) func() {
	namespace, name := pod.Namespace, pod.Name
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), config.NodeDebugPodDeleteTimeout)
		defer cancel()
		if err := service.DeleteDebugPod(ctx, namespace, name); err != nil && o.logger != nil {
			o.logger.Warn(fmt.Sprintf("Failed to delete node shell debug pod %s/%s on cluster %s: %v", namespace, name, clusterID, err), logsources.ShellSession)
		}
	}
}
