package backend

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
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

// A cluster removed while its debug pod starts must not get a session, and the
// pod it left behind is deleted.
func TestStartNodeShellSessionRejectsStartAfterClusterStopped(t *testing.T) {
	fixture := newNodeShellFixture(t, runningDebugger())
	var stopOnce sync.Once
	fixture.client.PrependReactor("get", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
		stopOnce.Do(func() { fixture.operations.StopCluster(shellClusterID) })
		return false, nil, nil
	})

	_, err := fixture.operations.StartNodeShellSession(NodeShellSessionRequest{
		Target: nodeShellTarget(nodeShellNodeName), Image: "busybox:latest",
	})

	require.Error(t, err)
	require.True(t, strings.Contains(err.Error(), "cluster disconnected"), "unexpected error: %v", err)
	require.Empty(t, fixture.debugPods(t))
	require.Empty(t, fixture.operations.ListShellSessions())
}
