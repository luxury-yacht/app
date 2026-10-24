package backend

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	podspkg "github.com/luxury-yacht/app/backend/resources/pods"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StartNodeShellSession is `kubectl debug node/<name> --profile=sysadmin -it`:
// it creates a privileged debug pod on the node with the user's credentials,
// waits for it to run, and attaches a terminal to it. The session targets the
// Node. The app owns the debug pod from before it is created until a delete
// succeeds: ending the session by any path deletes it, and a failed delete
// keeps the session listed so the user can retry.
func (o *OperationsCoordinator) StartNodeShellSession(req NodeShellSessionRequest) (*ShellSession, error) {
	clusterID := req.Target.ClusterID
	operationEpoch := o.clusterOperationEpoch(clusterID)
	image, err := validateNodeShellRequest(req)
	if err != nil {
		return nil, shellStartError(req.Target, err)
	}
	// Cluster removal and shutdown cancel a registered start and wait until
	// it has deleted whatever it created.
	startCtx, start, ok := o.beginShellStart(clusterID, operationEpoch)
	if !ok {
		return nil, shellStartError(req.Target, errShellClusterDisconnected)
	}
	defer o.finishShellStart(start)
	launch, err := o.prepareNodeShellLaunch(startCtx, req, image, operationEpoch)
	if err != nil {
		return nil, shellStartError(req.Target, err)
	}
	return o.openShellSession(launch, operationEpoch)
}

func (o *OperationsCoordinator) prepareNodeShellLaunch(
	ctx context.Context,
	req NodeShellSessionRequest,
	image string,
	operationEpoch uint64,
) (shellLaunch, error) {
	deps, err := o.resolveShellDependencies(req.Target.ClusterID)
	if err != nil {
		return shellLaunch{}, err
	}

	requestCtx, cancel := context.WithTimeout(ctx, config.ShellSessionShutdownTimeout)
	defer cancel()
	// Like kubectl, resolve the node first: a pod bound to a missing node would
	// wait until the start timeout instead of failing.
	if _, err := deps.KubernetesClient.CoreV1().Nodes().Get(requestCtx, req.Target.Name, metav1.GetOptions{}); err != nil {
		return shellLaunch{}, fmt.Errorf("failed to load node: %w", err)
	}
	if err := o.requireNodeShellPermissions(requestCtx, deps); err != nil {
		return shellLaunch{}, err
	}

	owner := newNodeDebugPodOwner(req.Target.ClusterID, deps, nodes.NewDebugPod(req.Target.Name, image, req.Command))
	launch, err := o.launchNodeDebugPod(requestCtx, ctx, req, owner)
	if err != nil {
		return shellLaunch{}, o.releaseFailedNodeShellStart(owner, req, operationEpoch, err)
	}
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

// launchNodeDebugPod creates the debug pod, waits for its debugger container,
// and builds the attach stream to it.
func (o *OperationsCoordinator) launchNodeDebugPod(
	createCtx context.Context,
	waitCtx context.Context,
	req NodeShellSessionRequest,
	owner *nodeDebugPodOwner,
) (shellLaunch, error) {
	if err := owner.create(createCtx); err != nil {
		return shellLaunch{}, err
	}
	if err := owner.service.WaitForDebugPod(waitCtx, owner.pod.Namespace, owner.pod.Name); err != nil {
		return shellLaunch{}, err
	}
	executor, err := o.buildShellExecutor(owner.deps, owner.pod.Namespace, owner.pod.Name, "attach", &corev1.PodAttachOptions{
		Container: nodes.DebugPodContainerName,
		Stdin:     true,
		Stdout:    true,
		Stderr:    true,
		TTY:       true,
	})
	if err != nil {
		return shellLaunch{}, err
	}
	return shellLaunch{
		deps:      owner.deps,
		target:    nodeShellSessionTarget(req),
		pod:       owner.pod,
		container: nodes.DebugPodContainerName,
		command:   append([]string(nil), req.Command...),
		executor:  executor,
		debugPod:  owner.ref(),
		release:   owner.release,
	}, nil
}

func nodeShellSessionTarget(req NodeShellSessionRequest) RuntimeOperationTargetRef {
	return *runtimeOperationTarget(req.Target.ClusterID, nodes.Identity.Group, nodes.Identity.Version, nodes.Identity.Kind, "", req.Target.Name)
}

// releaseFailedNodeShellStart deletes the debug pod a failed start may have
// created. If that fails too, the pod stays listed as a cleanup-failed session
// so it is not abandoned. It returns the error to report for the start.
func (o *OperationsCoordinator) releaseFailedNodeShellStart(
	owner *nodeDebugPodOwner,
	req NodeShellSessionRequest,
	operationEpoch uint64,
	cause error,
) error {
	releaseErr := owner.release()
	if releaseErr == nil {
		return cause
	}
	o.retainNodeDebugPod(owner, req, operationEpoch, releaseErr)
	return fmt.Errorf("%w; %v", cause, releaseErr)
}

// retainNodeDebugPod lists a debug pod a failed start could not delete as a
// cleanup-failed session without a stream; ending it retries the delete. If the
// cluster has been removed meanwhile, nothing can retry and the pod is logged.
func (o *OperationsCoordinator) retainNodeDebugPod(
	owner *nodeDebugPodOwner,
	req NodeShellSessionRequest,
	operationEpoch uint64,
	releaseErr error,
) {
	now := time.Now()
	sess := &shellSession{
		id:             uuid.NewString(),
		clusterID:      req.Target.ClusterID,
		clusterName:    owner.clusterName(),
		target:         nodeShellSessionTarget(req),
		debugPod:       owner.ref(),
		release:        owner.release,
		container:      nodes.DebugPodContainerName,
		command:        append([]string(nil), req.Command...),
		startedAt:      now,
		lastActivity:   now,
		operationEpoch: operationEpoch,
	}
	lifecycle := o.shellSessionLifecycle()
	if !lifecycle.register(sess) {
		o.logShellReleaseFailure(sess, releaseErr)
		return
	}
	lifecycle.retainForCleanup(sess, releaseErr)
}

// nodeDebugPodOwner is the app's ownership of a debug pod it created or may
// have created. It holds the pod's identity from before the create call until
// a delete succeeds.
type nodeDebugPodOwner struct {
	clusterID string
	deps      common.Dependencies
	service   *nodes.Service
	pod       *corev1.Pod

	mu       sync.Mutex
	released bool
}

func newNodeDebugPodOwner(clusterID string, deps common.Dependencies, pod *corev1.Pod) *nodeDebugPodOwner {
	return &nodeDebugPodOwner{clusterID: clusterID, deps: deps, service: nodes.NewService(deps), pod: pod}
}

// create creates the pod. A rejection that created nothing of ours (any 4xx,
// including AlreadyExists for another owner's pod) ends the ownership; any
// other failure may have committed the pod, so it stays owned for release.
func (d *nodeDebugPodOwner) create(ctx context.Context) error {
	created, err := d.service.CreateDebugPod(ctx, d.pod)
	if err == nil {
		d.pod = created
		return nil
	}
	if !nodes.DebugPodCreateMayHaveCommitted(err) {
		d.mu.Lock()
		d.released = true
		d.mu.Unlock()
	}
	return err
}

// release deletes the pod by its name. It uses its own bounded context because
// it also runs after the app context is cancelled during shutdown. Releasing a
// released pod does nothing.
func (d *nodeDebugPodOwner) release() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.released {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.NodeDebugPodDeleteTimeout)
	defer cancel()
	if err := d.service.DeleteDebugPod(ctx, d.pod.Namespace, d.pod.Name); err != nil {
		return fmt.Errorf("debug pod %s/%s was not deleted: %w", d.pod.Namespace, d.pod.Name, err)
	}
	d.released = true
	return nil
}

func (d *nodeDebugPodOwner) ref() *RuntimeOperationTargetRef {
	return runtimeOperationTarget(d.clusterID, podspkg.Identity.Group, podspkg.Identity.Version, podspkg.Identity.Kind, d.pod.Namespace, d.pod.Name)
}

func (d *nodeDebugPodOwner) clusterName() string {
	if d.deps.ClusterName != "" {
		return d.deps.ClusterName
	}
	return d.clusterID
}
