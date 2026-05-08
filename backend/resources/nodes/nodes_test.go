/*
 * backend/resources/nodes/nodes_test.go
 *
 * Tests for Node resource handlers.
 * - Covers Node resource handlers behavior and edge cases.
 */

package nodes_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestServiceNodeReturnsDetails(t *testing.T) {
	service, _, node := newNodeService(t)

	detail, err := service.Node(node.Name)
	require.NoError(t, err)
	require.Equal(t, node.Name, detail.Name)
	require.Equal(t, "Ready", detail.Status)
	require.Equal(t, "True", detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
	require.Equal(t, "10.0.0.5", detail.InternalIP)
	require.Equal(t, 2, detail.PodsCount)
	require.NotEmpty(t, detail.PodsList)
	require.Equal(t, "ready", detail.PodsList[0].StatusPresentation)
	require.Equal(t, int32(1), detail.Restarts)
}

func TestServiceNodeStatusUsesSharedResourceModel(t *testing.T) {
	service, client, node := newNodeService(t)
	current, err := client.CoreV1().Nodes().Get(context.Background(), node.Name, metav1.GetOptions{})
	require.NoError(t, err)
	current.Spec.Unschedulable = true
	_, err = client.CoreV1().Nodes().Update(context.Background(), current, metav1.UpdateOptions{})
	require.NoError(t, err)

	detail, err := service.Node(node.Name)
	require.NoError(t, err)
	require.Equal(t, "Ready (Cordoned)", detail.Status)
	require.Equal(t, "True", detail.StatusState)
	require.Equal(t, "cordoned", detail.StatusPresentation)
	require.Equal(t, "Unschedulable", detail.StatusReason)
	require.True(t, detail.Unschedulable)
}

func TestServiceDeleteHonorsForce(t *testing.T) {
	service, client, node := newNodeService(t)

	var recordedGrace *int64
	client.Fake.PrependReactor("delete", "nodes", func(action cgotesting.Action) (bool, runtime.Object, error) {
		deleteAction := action.(cgotesting.DeleteAction)
		opts := deleteAction.GetDeleteOptions()
		if opts.GracePeriodSeconds != nil {
			val := *opts.GracePeriodSeconds
			recordedGrace = &val
		}
		return false, nil, nil
	})

	require.NoError(t, service.Delete(node.Name, true))
	require.NotNil(t, recordedGrace)
	require.Equal(t, int64(0), *recordedGrace)
}

func TestServiceDeleteWithoutForceUsesDefaultGrace(t *testing.T) {
	service, client, node := newNodeService(t)

	var recordedGraceSeen bool
	client.Fake.PrependReactor("delete", "nodes", func(action cgotesting.Action) (bool, runtime.Object, error) {
		deleteAction := action.(cgotesting.DeleteAction)
		if opts := deleteAction.GetDeleteOptions(); opts.GracePeriodSeconds != nil {
			recordedGraceSeen = true
		}
		return false, nil, nil
	})

	require.NoError(t, service.Delete(node.Name, false))
	require.False(t, recordedGraceSeen, "default delete should not force grace period")
}

func TestServiceDeleteReturnsEnsureClientError(t *testing.T) {
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsEnsureClient(func(string) error { return errors.New("ensure failed") }),
	)
	service := nodes.NewService(deps)

	err := service.Delete("node-1", false)
	require.Error(t, err)
	require.Contains(t, err.Error(), "ensure failed")
}

func TestServiceCordonAndUncordon(t *testing.T) {
	service, client, node := newNodeService(t)
	addNodePatchReactor(t, client)

	require.NoError(t, service.Cordon(node.Name))

	updated, err := client.CoreV1().Nodes().Get(context.Background(), node.Name, metav1.GetOptions{})
	require.NoError(t, err)
	require.True(t, updated.Spec.Unschedulable)

	require.NoError(t, service.Uncordon(node.Name))
	updated, err = client.CoreV1().Nodes().Get(context.Background(), node.Name, metav1.GetOptions{})
	require.NoError(t, err)
	require.False(t, updated.Spec.Unschedulable)
}

func TestServiceDrainDeletesPods(t *testing.T) {
	service, client, node := newNodeService(t)
	addNodePatchReactor(t, client)

	options := types.DrainNodeOptions{
		DisableEviction:            true,
		DeleteEmptyDirData:         true,
		IgnoreDaemonSets:           true,
		SkipWaitForPodsToTerminate: true,
	}

	require.NoError(t, service.Drain(node.Name, options))

	list, err := client.CoreV1().Pods("").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	for _, pod := range list.Items {
		require.NotEqual(t, node.Name, pod.Spec.NodeName, "expected pod %s/%s to be removed from drained node", pod.Namespace, pod.Name)
	}
}

func TestServiceDrainDeleteUsesPodDefaultGraceWhenUnset(t *testing.T) {
	service, client, node := newNodeService(t)
	addNodePatchReactor(t, client)

	recordedGrace := make([]*int64, 0)
	client.Fake.PrependReactor("delete", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		deleteAction := action.(cgotesting.DeleteAction)
		recordedGrace = append(recordedGrace, deleteAction.GetDeleteOptions().GracePeriodSeconds)
		return false, nil, nil
	})

	options := types.DrainNodeOptions{
		DisableEviction:            true,
		DeleteEmptyDirData:         true,
		IgnoreDaemonSets:           true,
		SkipWaitForPodsToTerminate: true,
	}

	require.NoError(t, service.Drain(node.Name, options))
	require.NotEmpty(t, recordedGrace)
	for _, grace := range recordedGrace {
		require.Nil(t, grace, "unset gracePeriodSeconds should omit pod delete grace period")
	}
}

func TestServiceDrainEvictionUsesPodDefaultGraceWhenUnset(t *testing.T) {
	service, client, node := newNodeService(t)
	addNodePatchReactor(t, client)

	recordedGrace := make([]*int64, 0)
	client.Fake.PrependReactor("create", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		if createAction.GetSubresource() != "eviction" {
			return false, nil, nil
		}
		eviction := createAction.GetObject().(*policyv1.Eviction)
		if eviction.DeleteOptions == nil {
			recordedGrace = append(recordedGrace, nil)
		} else {
			recordedGrace = append(recordedGrace, eviction.DeleteOptions.GracePeriodSeconds)
		}
		return true, eviction, nil
	})

	options := types.DrainNodeOptions{
		DeleteEmptyDirData:         true,
		IgnoreDaemonSets:           true,
		SkipWaitForPodsToTerminate: true,
	}

	require.NoError(t, service.Drain(node.Name, options))
	require.NotEmpty(t, recordedGrace)
	for _, grace := range recordedGrace {
		require.Nil(t, grace, "unset gracePeriodSeconds should omit pod eviction grace period")
	}
}

func TestServiceDrainValidatesGracePeriod(t *testing.T) {
	service, _, node := newNodeService(t)

	negativeGrace := -1
	err := service.Drain(node.Name, types.DrainNodeOptions{GracePeriodSeconds: &negativeGrace})
	require.EqualError(t, err, "gracePeriodSeconds must be non-negative")

	tooLongGrace := 901
	err = service.Drain(node.Name, types.DrainNodeOptions{GracePeriodSeconds: &tooLongGrace})
	require.EqualError(t, err, "gracePeriodSeconds must be less than or equal to 900")
}

func TestServiceDrainValidatesTimeout(t *testing.T) {
	service, _, node := newNodeService(t)

	negativeTimeout := -1
	err := service.Drain(node.Name, types.DrainNodeOptions{TimeoutSeconds: &negativeTimeout})
	require.EqualError(t, err, "timeoutSeconds must be non-negative")

	zeroTimeout := 0
	require.NoError(t, nodes.ValidateDrainOptions(types.DrainNodeOptions{TimeoutSeconds: &zeroTimeout}))
}

func TestServiceDrainLeavesNodeCordonedAfterFailure(t *testing.T) {
	service, client, node := newNodeService(t)
	addNodePatchReactor(t, client)

	pod := testsupport.PodFixture("frontend", "local-data")
	pod.Spec.NodeName = node.Name
	pod.Spec.Volumes = []corev1.Volume{{
		Name: "scratch",
		VolumeSource: corev1.VolumeSource{
			EmptyDir: &corev1.EmptyDirVolumeSource{},
		},
	}}
	markControllerManaged(pod)
	_, err := client.CoreV1().Pods(pod.Namespace).Create(context.Background(), pod, metav1.CreateOptions{})
	require.NoError(t, err)

	err = service.Drain(node.Name, types.DrainNodeOptions{
		DeleteEmptyDirData: false,
		IgnoreDaemonSets:   true,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "local storage")

	updated, err := client.CoreV1().Nodes().Get(context.Background(), node.Name, metav1.GetOptions{})
	require.NoError(t, err)
	require.True(t, updated.Spec.Unschedulable, "failed drain should leave the node cordoned")
}

func TestServiceDrainUsesKubectlDaemonSetFiltering(t *testing.T) {
	service, client, node := newNodeService(t)
	addNodePatchReactor(t, client)

	daemonSet := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: "node-agent", Namespace: "frontend"},
	}
	_, err := client.AppsV1().DaemonSets("frontend").Create(context.Background(), daemonSet, metav1.CreateOptions{})
	require.NoError(t, err)

	pod := testsupport.PodFixture("frontend", "node-agent-pod")
	pod.Spec.NodeName = node.Name
	controller := true
	pod.OwnerReferences = []metav1.OwnerReference{{
		APIVersion: "apps/v1",
		Kind:       "DaemonSet",
		Name:       daemonSet.Name,
		Controller: &controller,
	}}
	_, err = client.CoreV1().Pods(pod.Namespace).Create(context.Background(), pod, metav1.CreateOptions{})
	require.NoError(t, err)

	options := types.DrainNodeOptions{
		DisableEviction:            true,
		DeleteEmptyDirData:         true,
		SkipWaitForPodsToTerminate: true,
	}
	err = service.Drain(node.Name, options)
	require.Error(t, err)
	require.Contains(t, err.Error(), "DaemonSet-managed Pods")

	options.IgnoreDaemonSets = true
	require.NoError(t, service.Drain(node.Name, options))
}

func TestServiceDrainUsesKubectlUnmanagedPodFiltering(t *testing.T) {
	service, client, node := newNodeService(t)
	addNodePatchReactor(t, client)

	pod := testsupport.PodFixture("frontend", "unmanaged")
	pod.Spec.NodeName = node.Name
	_, err := client.CoreV1().Pods(pod.Namespace).Create(context.Background(), pod, metav1.CreateOptions{})
	require.NoError(t, err)

	options := types.DrainNodeOptions{
		DisableEviction:            true,
		DeleteEmptyDirData:         true,
		IgnoreDaemonSets:           true,
		SkipWaitForPodsToTerminate: true,
	}
	err = service.Drain(node.Name, options)
	require.Error(t, err)
	require.Contains(t, err.Error(), "declare no controller")

	options.Force = true
	require.NoError(t, service.Drain(node.Name, options))
}

func newNodeService(t *testing.T) (*nodes.Service, *fake.Clientset, *corev1.Node) {
	t.Helper()
	ctx := context.Background()

	now := time.Now()

	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
			Labels: map[string]string{
				"node-role.kubernetes.io/worker": "",
			},
		},
		Status: corev1.NodeStatus{
			NodeInfo: corev1.NodeSystemInfo{
				Architecture:            "amd64",
				OperatingSystem:         "linux",
				KernelVersion:           "6.1.0",
				ContainerRuntimeVersion: "containerd://1.7",
				KubeletVersion:          "v1.29.0",
			},
			Conditions: []corev1.NodeCondition{{
				Type:   corev1.NodeReady,
				Status: corev1.ConditionTrue,
			}},
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("8"),
				corev1.ResourceMemory: resource.MustParse("16Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("7"),
				corev1.ResourceMemory: resource.MustParse("15Gi"),
				corev1.ResourcePods:   resource.MustParse("100"),
			},
			Addresses: []corev1.NodeAddress{
				{Type: corev1.NodeInternalIP, Address: "10.0.0.5"},
				{Type: corev1.NodeHostName, Address: "node-1.local"},
			},
		},
	}

	podA := testsupport.PodFixture("frontend", "app-0")
	podA.Spec.NodeName = node.Name
	podA.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "app", RestartCount: 1, Ready: true}}
	markControllerManaged(podA)

	podB := testsupport.PodFixture("frontend", "app-1")
	podB.Spec.NodeName = node.Name
	podB.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "app", RestartCount: 0, Ready: true}}
	markControllerManaged(podB)

	client := fake.NewClientset(node.DeepCopy(), podA.DeepCopy(), podB.DeepCopy())
	seedEvictionSupport(t, client)

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(ctx),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
	)

	service := nodes.NewService(deps)
	return service, client, node
}

func markControllerManaged(pod *corev1.Pod) {
	controller := true
	pod.OwnerReferences = []metav1.OwnerReference{{
		APIVersion: "apps/v1",
		Kind:       "ReplicaSet",
		Name:       "frontend",
		Controller: &controller,
	}}
}

func seedEvictionSupport(t *testing.T, client *fake.Clientset) {
	t.Helper()

	discoveryClient, ok := client.Discovery().(*fakediscovery.FakeDiscovery)
	require.True(t, ok, "expected fake discovery client")
	discoveryClient.Resources = []*metav1.APIResourceList{{
		GroupVersion: "v1",
		APIResources: []metav1.APIResource{{
			Name:    "pods/eviction",
			Kind:    "Eviction",
			Group:   "policy",
			Version: "v1",
		}},
	}}
}

func addNodePatchReactor(t *testing.T, client *fake.Clientset) {
	t.Helper()

	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"}
	client.Fake.PrependReactor("patch", "nodes", func(action cgotesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(cgotesting.PatchAction)
		current, err := client.Tracker().Get(gvr, "", patchAction.GetName())
		if err != nil {
			return true, nil, err
		}
		node := current.(*corev1.Node).DeepCopy()

		var payload struct {
			Spec struct {
				Unschedulable bool `json:"unschedulable"`
			} `json:"spec"`
		}
		if err := json.Unmarshal(patchAction.GetPatch(), &payload); err != nil {
			return true, nil, err
		}

		node.Spec.Unschedulable = payload.Spec.Unschedulable
		if err := client.Tracker().Update(gvr, node, ""); err != nil {
			return true, nil, err
		}
		return true, node, nil
	})
}
