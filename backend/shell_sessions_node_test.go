package backend

import (
	"context"
	"errors"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	cgotesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/remotecommand"
)

const nodeShellNodeName = "worker-1"

// nodeShellTarget is the complete identity of a Node in the shell test cluster.
func nodeShellTarget(name string) resourcemodel.ResourceRef {
	return resourcemodel.ResourceRef{ClusterID: shellClusterID, Version: "v1", Kind: "Node", Name: name}
}

type nodeShellFixture struct {
	operations *OperationsCoordinator
	client     *fake.Clientset

	mu         sync.Mutex
	attachURLs []string
}

// newNodeShellFixture serves one Node and stands in for kubelet: every debug
// pod the shell creates reports the given debugger container state.
func newNodeShellFixture(t *testing.T, debugger corev1.ContainerState) *nodeShellFixture {
	t.Helper()
	coordinatorFixture := newOperationsCoordinatorFixture(t)
	app := coordinatorFixture.runtime
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	client := fake.NewClientset(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: nodeShellNodeName}})
	allowSelfSubjectAccessReviews(client)
	client.PrependReactor("create", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		pod := action.(cgotesting.CreateAction).GetObject().(*corev1.Pod)
		pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "debugger", State: debugger}}
		return false, nil, nil
	})
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            execURLClientset{Clientset: client},
			restConfig:        &rest.Config{},
		},
	}

	fixture := &nodeShellFixture{operations: coordinatorFixture.coordinator, client: client}
	fixture.operations.websocketExec = func(_ *rest.Config, _ string, rawURL string) (remotecommand.Executor, error) {
		fixture.mu.Lock()
		fixture.attachURLs = append(fixture.attachURLs, rawURL)
		fixture.mu.Unlock()
		return blockingShellExecutor{}, nil
	}
	fixture.operations.spdyExecutor = func(*rest.Config, string, *url.URL) (remotecommand.Executor, error) {
		return blockingShellExecutor{}, nil
	}
	return fixture
}

func runningDebugger() corev1.ContainerState {
	return corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
}

func (f *nodeShellFixture) debugPods(t *testing.T) []corev1.Pod {
	t.Helper()
	pods, err := f.client.CoreV1().Pods("default").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	return pods.Items
}

func (f *nodeShellFixture) start(t *testing.T) *ShellSession {
	t.Helper()
	session, err := f.operations.StartNodeShellSession(NodeShellSessionRequest{
		Target:  nodeShellTarget(nodeShellNodeName),
		Image:   "busybox:latest",
		Command: []string{"/bin/sh"},
	})
	require.NoError(t, err)
	return session
}

// A node shell is opened for a Node; any other object reference is refused
// before the cluster is contacted.
func TestStartNodeShellSessionRejectsNonNodeTarget(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())

	_, err := fixture.operations.StartNodeShellSession(NodeShellSessionRequest{
		Target: shellPodTarget("default", "pod-1"), Image: "busybox:latest",
	})

	require.ErrorContains(t, err, "v1 Node target required, got v1 Pod")
	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
}

// kubectl refuses node debugging without an image; so does the node shell.
func TestStartNodeShellSessionRequiresImage(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())

	_, err := fixture.operations.StartNodeShellSession(NodeShellSessionRequest{Target: nodeShellTarget(nodeShellNodeName)})

	require.ErrorContains(t, err, "image is required")
	require.Empty(t, fixture.debugPods(t))
}

// The debug pod is created with the user's own RBAC: a denied check creates
// nothing on the cluster and registers no session.
func TestStartNodeShellSessionPermissionDenialCreatesNoPod(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	denySelfSubjectAccessReviews(fixture.client, "pods are off limits")

	_, err := fixture.operations.StartNodeShellSession(NodeShellSessionRequest{
		Target: nodeShellTarget(nodeShellNodeName), Image: "busybox:latest",
	})

	require.ErrorContains(t, err, "pods are off limits")
	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
}

// The node shell creates kubectl's debug pod in default on the chosen node,
// attaches to its debugger container, and publishes the Node as the session
// target with the debug pod alongside, so reattach and Sessions navigation open
// the Node while the UI can name the pod.
func TestStartNodeShellSessionAttachesToDebugPodOnNode(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())

	session := fixture.start(t)
	t.Cleanup(func() { _ = fixture.operations.CloseShellSession(session.SessionID) })

	pods := fixture.debugPods(t)
	require.Len(t, pods, 1)
	pod := pods[0]
	require.Equal(t, nodeShellNodeName, pod.Spec.NodeName)
	require.Equal(t, "busybox:latest", pod.Spec.Containers[0].Image)
	require.Equal(t, []string{"/bin/sh"}, pod.Spec.Containers[0].Command)

	fixture.mu.Lock()
	attachURLs := append([]string(nil), fixture.attachURLs...)
	fixture.mu.Unlock()
	require.Len(t, attachURLs, 1)
	require.Contains(t, attachURLs[0], "/namespaces/default/pods/"+pod.Name+"/attach")
	require.Contains(t, attachURLs[0], "container=debugger")

	nodeRef := nodeShellTarget(nodeShellNodeName)
	podRef := resourcemodel.ResourceRef{ClusterID: shellClusterID, Version: "v1", Kind: "Pod", Namespace: "default", Name: pod.Name}
	require.Equal(t, nodeRef, session.Target)
	require.NotNil(t, session.DebugPod)
	require.Equal(t, podRef, *session.DebugPod)
	require.Equal(t, "debugger", session.Container)

	listed := fixture.operations.ListShellSessions()
	require.Len(t, listed, 1)
	require.Equal(t, nodeRef, listed[0].Target)
	require.NotNil(t, listed[0].DebugPod)
	require.Equal(t, podRef, *listed[0].DebugPod)

	operations := fixture.operations.ListRuntimeOperations()
	require.Len(t, operations, 1)
	require.Equal(t, nodeRef, *operations[0].Target)
}

// Ending the session from the Shell tab or the Sessions list removes the
// privileged debug pod the app created.
func TestEndingNodeShellSessionDeletesDebugPod(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	session := fixture.start(t)
	require.Len(t, fixture.debugPods(t), 1)

	require.NoError(t, fixture.operations.CloseShellSession(session.SessionID))

	require.Empty(t, fixture.debugPods(t))
}

// Cluster removal and app shutdown end every session for the cluster; their
// debug pods are removed too.
func TestStopClusterDeletesNodeShellDebugPod(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	fixture.start(t)

	fixture.operations.StopCluster(shellClusterID)

	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
}

// A debug pod whose shell cannot start is deleted, and the user sees kubelet's
// reason instead of a session.
func TestStartNodeShellSessionDeletesDebugPodWhenShellCannotStart(t *testing.T) {
	fixture := newNodeShellFixture(t, corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
		Reason: "StartError", Message: `exec: "/bin/bash": stat /bin/bash: no such file or directory`, ExitCode: 128,
	}})

	_, err := fixture.operations.StartNodeShellSession(NodeShellSessionRequest{
		Target: nodeShellTarget(nodeShellNodeName), Image: "busybox:latest", Command: []string{"/bin/bash"},
	})

	require.ErrorContains(t, err, "/bin/bash")
	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
}

func startingDebugger() corev1.ContainerState {
	return corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}
}

func nodeShellRequest() NodeShellSessionRequest {
	return NodeShellSessionRequest{Target: nodeShellTarget(nodeShellNodeName), Image: "busybox:latest"}
}

// startInBackground starts a node shell that is still waiting for its pod and
// returns once the pod exists, with the start's eventual error.
func (f *nodeShellFixture) startInBackground(t *testing.T) <-chan error {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		_, err := f.operations.StartNodeShellSession(nodeShellRequest())
		done <- err
	}()
	require.Eventually(t, func() bool { return len(f.debugPods(t)) == 1 }, 5*time.Second, 5*time.Millisecond)
	return done
}

// failDeletes makes pod deletes fail while the returned flag is set.
func (f *nodeShellFixture) failDeletes() *atomic.Bool {
	failing := &atomic.Bool{}
	failing.Store(true)
	f.client.PrependReactor("delete", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
		if failing.Load() {
			return true, nil, errors.New("dial tcp: connection refused")
		}
		return false, nil, nil
	})
	return failing
}

func requireStartEnded(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("node shell start did not end")
	}
}

// Closing the cluster while a node shell's pod is still starting cancels the
// start and deletes the pod before StopCluster returns.
func TestStopClusterDeletesStartingNodeShellDebugPod(t *testing.T) {
	fixture := newNodeShellFixture(t, startingDebugger())
	done := fixture.startInBackground(t)

	fixture.operations.StopCluster(shellClusterID)

	require.Empty(t, fixture.debugPods(t), "cluster removal must delete a starting node shell's pod")
	requireStartEnded(t, done)
	require.Empty(t, fixture.operations.ListShellSessions())
}

// Quitting the app while a node shell starts must not return before its
// debug pod's delete has finished.
func TestShutdownWaitsForStartingNodeShellDelete(t *testing.T) {
	fixture := newNodeShellFixture(t, startingDebugger())
	fixture.client.PrependReactor("delete", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
		time.Sleep(100 * time.Millisecond)
		return false, nil, nil
	})
	done := fixture.startInBackground(t)

	fixture.operations.Shutdown()

	require.Empty(t, fixture.debugPods(t), "shutdown returned before the debug pod was deleted")
	requireStartEnded(t, done)
}

// A delete that fails keeps the session in Sessions in an error state naming
// the pod, so ending it again retries until the pod is gone.
func TestFailedDebugPodDeleteKeepsNodeShellForRetry(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	session := fixture.start(t)
	failing := fixture.failDeletes()

	err := fixture.operations.CloseShellSession(session.SessionID)

	require.ErrorContains(t, err, session.DebugPod.Name)
	require.ErrorContains(t, err, "connection refused")
	require.Len(t, fixture.debugPods(t), 1)
	listed := fixture.operations.ListShellSessions()
	require.Len(t, listed, 1)
	require.Equal(t, types.ShellSessionStatusCleanupFailed, listed[0].Status)
	require.Contains(t, listed[0].StatusReason, session.DebugPod.Name)
	operations := fixture.operations.ListRuntimeOperations()
	require.Len(t, operations, 1)
	require.Equal(t, "error", operations[0].Status)

	failing.Store(false)
	require.NoError(t, fixture.operations.CloseShellSession(session.SessionID))

	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
	require.Empty(t, fixture.operations.ListRuntimeOperations())
}

// exitedShellExecutor ends its stream at once, as when the user types exit.
type exitedShellExecutor struct{}

func (exitedShellExecutor) Stream(remotecommand.StreamOptions) error { return nil }

func (exitedShellExecutor) StreamWithContext(context.Context, remotecommand.StreamOptions) error {
	return nil
}

// A shell that exits on its own also keeps its pod's ownership when the
// delete fails.
func TestShellExitWithFailedDebugPodDeleteKeepsNodeShell(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	fixture.operations.websocketExec = func(*rest.Config, string, string) (remotecommand.Executor, error) {
		return exitedShellExecutor{}, nil
	}
	fixture.failDeletes()

	fixture.start(t)

	require.Eventually(t, func() bool {
		listed := fixture.operations.ListShellSessions()
		return len(listed) == 1 && listed[0].Status == types.ShellSessionStatusCleanupFailed
	}, 5*time.Second, 5*time.Millisecond)
	require.Len(t, fixture.debugPods(t), 1)
}

// A start that fails after creating its pod keeps the pod in Sessions when it
// cannot delete it, instead of abandoning it.
func TestFailedStartKeepsDebugPodItCouldNotDelete(t *testing.T) {
	fixture := newNodeShellFixture(t, corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
		Reason: "StartError", Message: "exec: no such file", ExitCode: 128,
	}})
	failing := fixture.failDeletes()

	_, err := fixture.operations.StartNodeShellSession(nodeShellRequest())

	require.ErrorContains(t, err, "StartError")
	listed := fixture.operations.ListShellSessions()
	require.Len(t, listed, 1)
	require.Equal(t, types.ShellSessionStatusCleanupFailed, listed[0].Status)
	require.Equal(t, nodeShellTarget(nodeShellNodeName), listed[0].Target)

	failing.Store(false)
	require.NoError(t, fixture.operations.CloseShellSession(listed[0].SessionID))
	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
}

// A create whose response is lost may still have committed the pod; the start
// deletes it by the name it generated.
func TestStartDeletesDebugPodWhoseCreateResponseWasLost(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	fixture.client.PrependReactor("create", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		pod := action.(cgotesting.CreateAction).GetObject().(*corev1.Pod)
		require.NoError(t, fixture.client.Tracker().Create(corev1.SchemeGroupVersion.WithResource("pods"), pod, pod.Namespace))
		return true, nil, errors.New("http2: client connection lost")
	})

	_, err := fixture.operations.StartNodeShellSession(nodeShellRequest())

	require.ErrorContains(t, err, "connection lost")
	require.Empty(t, fixture.debugPods(t), "a committed pod must not be orphaned")
	require.Empty(t, fixture.operations.ListShellSessions())
}

// AlreadyExists means the generated name belongs to a pod the app did not
// create; it is never deleted.
func TestStartLeavesSameNamedPodItDidNotCreate(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	fixture.client.PrependReactor("create", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		pod := action.(cgotesting.CreateAction).GetObject().(*corev1.Pod)
		existing := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: pod.Namespace, Name: pod.Name}}
		require.NoError(t, fixture.client.Tracker().Create(corev1.SchemeGroupVersion.WithResource("pods"), existing, pod.Namespace))
		return true, nil, apierrors.NewAlreadyExists(corev1.Resource("pods"), pod.Name)
	})

	_, err := fixture.operations.StartNodeShellSession(nodeShellRequest())

	require.ErrorContains(t, err, "already exists")
	require.Len(t, fixture.debugPods(t), 1, "another owner's pod must be left alone")
	require.Empty(t, fixture.operations.ListShellSessions())
}

// Removing the cluster makes a final attempt to delete a pod kept after a
// failed delete.
func TestStopClusterRetriesKeptDebugPodDelete(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	session := fixture.start(t)
	failing := fixture.failDeletes()
	require.Error(t, fixture.operations.CloseShellSession(session.SessionID))
	failing.Store(false)

	fixture.operations.StopCluster(shellClusterID)

	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
}

// A pod kept after a failed start has no stream; terminal input and resizes
// for it fail cleanly instead of crashing the backend.
func TestKeptDebugPodWithoutStreamRejectsTerminalInput(t *testing.T) {
	fixture := newNodeShellFixture(t, corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
		Reason: "StartError", ExitCode: 128,
	}})
	fixture.failDeletes()
	_, err := fixture.operations.StartNodeShellSession(nodeShellRequest())
	require.Error(t, err)
	listed := fixture.operations.ListShellSessions()
	require.Len(t, listed, 1)

	require.Error(t, fixture.operations.SendShellInput(listed[0].SessionID, "ls\n"))
	require.Error(t, fixture.operations.ResizeShellSession(listed[0].SessionID, 80, 24))
}
