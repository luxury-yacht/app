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
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
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
	require.Equal(t, "10.0.0.5", detail.InternalIP)
	require.Equal(t, 2, detail.PodsCount)
	require.NotEmpty(t, detail.PodsList)
	require.Equal(t, int32(1), detail.Restarts)
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

	podB := testsupport.PodFixture("frontend", "app-1")
	podB.Spec.NodeName = node.Name
	podB.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "app", RestartCount: 0, Ready: true}}

	client := fake.NewClientset(node.DeepCopy(), podA.DeepCopy(), podB.DeepCopy())

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(ctx),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
	)

	service := nodes.NewService(deps)
	return service, client, node
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
