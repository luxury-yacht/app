package pods

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestCreateDebugContainerSuccess(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-pod",
			Namespace: "team-a",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app", Image: "nginx:latest"}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	client := fake.NewClientset(pod)
	fakeEphemeralStatusReactor(client)

	svc := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	resp, err := svc.CreateDebugContainer("team-a", "demo-pod", "busybox:latest", "app")
	require.NoError(t, err)
	require.NotEmpty(t, resp.ContainerName)
	require.Equal(t, "demo-pod", resp.PodName)
	require.Equal(t, "team-a", resp.Namespace)

	updated, err := client.CoreV1().Pods("team-a").Get(context.Background(), "demo-pod", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.EphemeralContainers, 1)

	ec := updated.Spec.EphemeralContainers[0]
	require.Equal(t, "busybox:latest", ec.Image)
	require.Equal(t, "app", ec.TargetContainerName)
	require.True(t, ec.Stdin)
	require.True(t, ec.TTY)

	// The reactor marks created debug containers as Running for readiness checks.
	require.Len(t, updated.Status.EphemeralContainerStatuses, 1)
	require.NotNil(t, updated.Status.EphemeralContainerStatuses[0].State.Running)
}

func TestCreateDebugContainerPollTimeout(t *testing.T) {
	oldTimeout := debugContainerPollTimeout
	oldInterval := debugContainerPollInterval
	debugContainerPollTimeout = 30 * time.Millisecond
	debugContainerPollInterval = 5 * time.Millisecond
	defer func() {
		debugContainerPollTimeout = oldTimeout
		debugContainerPollInterval = oldInterval
	}()

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-pod",
			Namespace: "team-a",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app", Image: "nginx:latest"}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	client := fake.NewClientset(pod)
	svc := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	_, err := svc.CreateDebugContainer("team-a", "demo-pod", "busybox:latest", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "timed out waiting for debug container")
}

func TestCreateDebugContainerValidation(t *testing.T) {
	client := fake.NewClientset()
	svc := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	_, err := svc.CreateDebugContainer("", "demo-pod", "busybox:latest", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "namespace is required")

	_, err = svc.CreateDebugContainer("team-a", "", "busybox:latest", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "pod name is required")

	_, err = svc.CreateDebugContainer("team-a", "demo-pod", "", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "image is required")
}

func TestCreateDebugContainerNilClient(t *testing.T) {
	svc := NewService(common.Dependencies{
		Context: context.Background(),
		Logger:  testsupport.NoopLogger{},
	})

	_, err := svc.CreateDebugContainer("team-a", "demo-pod", "busybox", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}

// fakeEphemeralStatusReactor injects running statuses for newly-created ephemeral containers.
func fakeEphemeralStatusReactor(client *fake.Clientset) {
	client.PrependReactor("get", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		getAction, ok := action.(k8stesting.GetAction)
		if !ok {
			return false, nil, nil
		}

		obj, err := client.Tracker().Get(corev1.SchemeGroupVersion.WithResource("pods"), getAction.GetNamespace(), getAction.GetName())
		if err != nil {
			return true, nil, err
		}

		pod, ok := obj.(*corev1.Pod)
		if !ok {
			return true, obj, nil
		}

		copyPod := pod.DeepCopy()
		existing := make(map[string]struct{}, len(copyPod.Status.EphemeralContainerStatuses))
		for _, status := range copyPod.Status.EphemeralContainerStatuses {
			existing[status.Name] = struct{}{}
		}
		for _, ec := range copyPod.Spec.EphemeralContainers {
			if _, found := existing[ec.Name]; found {
				continue
			}
			copyPod.Status.EphemeralContainerStatuses = append(copyPod.Status.EphemeralContainerStatuses, corev1.ContainerStatus{
				Name: ec.Name,
				State: corev1.ContainerState{
					Running: &corev1.ContainerStateRunning{StartedAt: metav1.Now()},
				},
			})
		}
		return true, copyPod, nil
	})
}
