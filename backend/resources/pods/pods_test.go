/*
 * backend/resources/pods/pods_test.go
 *
 * Tests for Pod resource handlers.
 * - Covers Pod resource handlers behavior and edge cases.
 */

package pods

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestGetPodReturnsDetailedInfo(t *testing.T) {
	now := time.Now()
	controller := true

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "demo-pod",
			Namespace:         "team-a",
			Labels:            map[string]string{"app": "demo"},
			Annotations:       map[string]string{"note": "test"},
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "demo-rs",
				Controller: &controller,
			}},
		},
		Spec: corev1.PodSpec{
			NodeName:                     "node-1",
			ServiceAccountName:           "builder",
			RuntimeClassName:             strPtr("gvisor"),
			SchedulerName:                "default-scheduler",
			AutomountServiceAccountToken: ptrBool(true),
			Containers: []corev1.Container{{
				Name:  "app",
				Image: "demo:1.0",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("250m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase:  corev1.PodRunning,
			PodIP:  "10.0.0.10",
			HostIP: "10.0.0.2",
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "app",
				Ready:        true,
				RestartCount: 1,
				State: corev1.ContainerState{
					Running: &corev1.ContainerStateRunning{
						StartedAt: metav1.NewTime(now.Add(-time.Hour)),
					},
				},
			}},
		},
	}

	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-rs",
			Namespace: "team-a",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "demo-deploy",
				Controller: &controller,
			}},
		},
	}

	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status: corev1.NodeStatus{
			Addresses: []corev1.NodeAddress{{
				Type:    corev1.NodeInternalIP,
				Address: "192.168.10.15",
			}},
		},
	}

	client := fake.NewClientset(pod, replicaSet, node)

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	}

	details, err := GetPod(deps, "team-a", "demo-pod", true)
	if err != nil {
		t.Fatalf("GetPod returned error: %v", err)
	}
	if details.OwnerKind != "Deployment" || details.OwnerName != "demo-deploy" {
		t.Fatalf("expected pod owner to resolve to Deployment/demo-deploy, got %s/%s", details.OwnerKind, details.OwnerName)
	}
	if details.NodeIP != "192.168.10.15" {
		t.Fatalf("expected node IP to be populated, got %q", details.NodeIP)
	}
	if len(details.Containers) != 1 {
		t.Fatalf("expected container details to be captured, got %#v", details.Containers)
	}
	if details.Containers[0].State != "running" {
		t.Fatalf("expected container state running, got %q", details.Containers[0].State)
	}
	if details.RuntimeClass != "gvisor" {
		t.Fatalf("expected runtime class to be gvisor, got %q", details.RuntimeClass)
	}
}

func TestGetPodPropagatesError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	}

	if _, err := GetPod(deps, "ns", "name", false); err == nil {
		t.Fatalf("expected error from GetPod when API fails")
	}
}

func TestDeletePodSucceeds(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "delete-me",
			Namespace: "team-a",
		},
	}
	client := fake.NewClientset(pod)

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	}

	if err := DeletePod(deps, "team-a", "delete-me"); err != nil {
		t.Fatalf("DeletePod returned error: %v", err)
	}

	var deleteFound bool
	for _, action := range client.Actions() {
		if action.Matches("delete", "pods") {
			deleteFound = true
			break
		}
	}
	if !deleteFound {
		t.Fatalf("expected delete action to be issued")
	}
}

func TestDeletePodReturnsErrorWhenAPIFails(t *testing.T) {
	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "delete-me", Namespace: "team-a"},
	})
	client.PrependReactor("delete", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("cannot delete")
	})

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	}

	if err := DeletePod(deps, "team-a", "delete-me"); err == nil {
		t.Fatalf("expected DeletePod to surface API error")
	}
}

func TestDeletePodReturnsErrorWhenContextMissing(t *testing.T) {
	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "delete-me", Namespace: "team-a"},
	})

	deps := common.Dependencies{
		Context:          nil,
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	}

	err := DeletePod(deps, "team-a", "delete-me")
	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}

func TestCalculatePodResourcesAggregates(t *testing.T) {
	pod := corev1.Pod{
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("100m"),
						corev1.ResourceMemory: resource.MustParse("64Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("200m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
				},
			}},
			InitContainers: []corev1.Container{{
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("250m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
				},
			}},
		},
	}

	cpuReq, cpuLim, memReq, memLim := calculatePodResources(pod)
	require.Equal(t, "250m", cpuReq.String())
	require.Equal(t, "500m", cpuLim.String())
	require.Equal(t, "256Mi", memReq.String())
	require.Equal(t, "512Mi", memLim.String())
}

func TestBuildReplicaSetToDeploymentMap(t *testing.T) {
	controller := true
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-rs",
			Namespace: "team-a",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "demo-deploy",
				Controller: &controller,
			}},
		},
	}

	client := fake.NewClientset(rs)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	mapping := service.buildReplicaSetToDeploymentMap("team-a")
	require.Equal(t, "demo-deploy", mapping["demo-rs"])
}

func TestBuildReplicaSetToDeploymentMapExported(t *testing.T) {
	controller := true
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-rs",
			Namespace: "team-a",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "demo-deploy",
				Controller: &controller,
			}},
		},
	}

	client := fake.NewClientset(rs)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	mapping := service.BuildReplicaSetToDeploymentMap("team-a")
	require.Equal(t, "demo-deploy", mapping["demo-rs"])
}

func TestBuildMultiNamespaceRSMapAggregates(t *testing.T) {
	controller := true
	rsA := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-a",
			Namespace: "team-a",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "deploy-a",
				Controller: &controller,
			}},
		},
	}
	rsB := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-b",
			Namespace: "team-b",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "deploy-b",
				Controller: &controller,
			}},
		},
	}

	client := fake.NewClientset(rsA, rsB)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	pods := []corev1.Pod{
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "team-a"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "team-b"}},
	}

	mapping := service.buildMultiNamespaceRSMap(pods)
	require.Equal(t, "deploy-a", mapping["demo-a"])
	require.Equal(t, "deploy-b", mapping["demo-b"])
}

func TestGetPodOwnerWithMap(t *testing.T) {
	controller := true
	pod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name:      "pod",
		Namespace: "team-a",
		OwnerReferences: []metav1.OwnerReference{{
			Kind:       "ReplicaSet",
			Name:       "demo-rs",
			Controller: &controller,
		}},
	}}
	mapping := map[string]string{"demo-rs": "demo-deploy"}
	kind, name := getPodOwnerWithMap(pod, mapping)
	require.Equal(t, "Deployment", kind)
	require.Equal(t, "demo-deploy", name)

	pod.ObjectMeta.OwnerReferences = []metav1.OwnerReference{{Kind: "Job", Name: "work", Controller: &controller}}
	kind, name = getPodOwnerWithMap(pod, mapping)
	require.Equal(t, "Job", kind)
	require.Equal(t, "work", name)
}

func TestFetchPodsWithFilter(t *testing.T) {
	pods := []runtime.Object{
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "a", Namespace: "team-a"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "b", Namespace: "team-b"}},
	}
	client := fake.NewClientset(pods...)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	teamPods, err := service.fetchPodsWithFilter("team-a", metav1.ListOptions{})
	require.NoError(t, err)
	require.Len(t, teamPods, 1)

	allPods, err := service.fetchPodsWithFilter("", metav1.ListOptions{})
	require.NoError(t, err)
	require.Len(t, allPods, 2)
}

func TestGetNodeIP(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status:     corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.1"}}},
	}
	client := fake.NewClientset(node)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	require.Equal(t, "10.0.0.1", service.getNodeIP("node-1"))
	require.Equal(t, "", service.getNodeIP("missing"))
}

func TestGetNodeIPReturnsEmptyOnError(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: fake.NewClientset(),
	})

	require.Equal(t, "", service.getNodeIP("node-does-not-exist"))
}

func TestNodeIPExported(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-2"},
		Status:     corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.2"}}},
	}
	client := fake.NewClientset(node)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	require.Equal(t, "10.0.0.2", service.NodeIP("node-2"))
}

func TestGetMultiNamespacePodMetrics(t *testing.T) {
	service := NewService(common.Dependencies{
		Context: context.Background(),
	})

	metrics := service.getMultiNamespacePodMetrics([]corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "team-a"}}})
	require.NotNil(t, metrics)
}

func TestPodsBySelectorPropagatesListError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("selector failure")
	})

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	_, err := service.podsBySelector("team-a", "app=demo")
	require.Error(t, err)
	require.Contains(t, err.Error(), "selector failure")
}

func TestPodsForCronJobReturnsEmptyWhenListingPodsFails(t *testing.T) {
	owner := metav1.OwnerReference{Kind: "CronJob", Name: "nightly", UID: types.UID("cron-uid"), Controller: ptrBool(true)}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "nightly-1",
			Namespace:       "team-a",
			OwnerReferences: []metav1.OwnerReference{owner},
		},
	}

	client := fake.NewClientset(job)

	var listCalls int
	client.PrependReactor("list", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		listCalls++
		return true, nil, fmt.Errorf("pods unavailable")
	})

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	pods, err := service.podsForCronJob("team-a", "nightly")
	require.NoError(t, err)
	require.Empty(t, pods)
	require.Equal(t, 1, listCalls)
}

func TestFetchPodsWithFilterPropagatesError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	_, err := service.fetchPodsWithFilter("team-a", metav1.ListOptions{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list pods")
}

func TestGetPodMetricsFallbackWhenClientMissing(t *testing.T) {
	service := NewService(common.Dependencies{
		Context: context.Background(),
		Logger:  testsupport.NoopLogger{},
	})

	metrics := service.getPodMetrics("team-a")
	require.Empty(t, metrics)
}

func TestGetPodMetricsForPodsUsesIndividualFetchForSmallSets(t *testing.T) {
	ctx := context.Background()
	var getCalls int
	//lint:ignore SA1019 No replacement for the deprecated method
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("get", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		getCalls++
		getAction, ok := action.(cgotesting.GetAction)
		require.True(t, ok)
		name := getAction.GetName()
		return true, buildPodMetrics("team-a", name), nil
	})

	service := NewService(common.Dependencies{
		Context:          ctx,
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: fake.NewClientset(),
		MetricsClient:    metricsClient,
	})

	pods := []corev1.Pod{{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "team-a"},
	}}

	metrics := service.getPodMetricsForPods("team-a", pods)
	require.Len(t, metrics, len(pods))

	require.Equal(t, len(pods), getCalls)
}

func TestGetPodMetricsForPodsListsForLargeSets(t *testing.T) {
	ctx := context.Background()
	var listCalls int
	//lint:ignore SA1019 No replacement for the deprecated method
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("list", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		listCalls++
		list := &metricsv1beta1.PodMetricsList{}
		for _, name := range []string{"pod-a", "pod-b", "pod-c", "pod-d"} {
			list.Items = append(list.Items, *buildPodMetrics("team-a", name))
		}
		return true, list, nil
	})

	service := NewService(common.Dependencies{
		Context:          ctx,
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: fake.NewClientset(),
		MetricsClient:    metricsClient,
	})

	pods := []corev1.Pod{
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "team-a"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "team-a"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-c", Namespace: "team-a"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-d", Namespace: "team-a"}},
	}

	metrics := service.getPodMetricsForPods("team-a", pods)
	require.Len(t, metrics, len(pods))

	require.Equal(t, 1, listCalls)
}

func TestGetPodMetricsListErrorReturnsEmpty(t *testing.T) {
	ctx := context.Background()
	//lint:ignore SA1019 No replacement for the deprecated method
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("list", "podmetricses", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("metrics unavailable")
	})

	service := NewService(common.Dependencies{
		Context:          ctx,
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: fake.NewClientset(),
		MetricsClient:    metricsClient,
	})

	values := service.getPodMetrics("team-a")
	require.Empty(t, values)
}

func TestSummarizePodUsesMetricsAndOwnership(t *testing.T) {
	now := metav1.NewTime(time.Now().Add(-30 * time.Minute))
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "demo",
			Namespace:         "team-a",
			CreationTimestamp: now,
			OwnerReferences: []metav1.OwnerReference{{
				UID:        types.UID("rs-uid"),
				Name:       "demo-rs",
				Kind:       "ReplicaSet",
				Controller: ptrBool(true),
			}},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name:  "app",
				Image: "demo:1.0",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("200m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("400m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:  "app",
				Ready: true,
			}},
		},
	}

	rsToDeployment := map[string]string{"demo-rs": "demo-deploy"}
	cpuUsage := resource.MustParse("150m")
	memUsage := resource.MustParse("64Mi")
	metrics := map[string]*metricsv1beta1.PodMetrics{
		"demo": {
			ObjectMeta: metav1.ObjectMeta{Name: "demo"},
			Containers: []metricsv1beta1.ContainerMetrics{{
				Name: "app",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    cpuUsage,
					corev1.ResourceMemory: memUsage,
				},
			}},
		},
	}

	ownerKind, ownerName := ResolveOwner(pod, rsToDeployment)
	summary := SummarizePod(pod, metrics, ownerKind, ownerName)
	require.Equal(t, "Deployment", summary.OwnerKind)
	require.Equal(t, "demo-deploy", summary.OwnerName)
	require.Equal(t, "150m", summary.CPUUsage)
	require.Equal(t, "64Mi", summary.MemUsage)
	require.Equal(t, "1/1", summary.Ready)
}

func TestGetPodStatusCoversEdgeCases(t *testing.T) {
	cases := []struct {
		name     string
		pod      corev1.Pod
		expected string
	}{
		{
			name: "evicted pod",
			pod: corev1.Pod{
				Status: corev1.PodStatus{Phase: corev1.PodFailed, Reason: "Evicted"},
			},
			expected: "Evicted",
		},
		{
			name: "init container waiting",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					InitContainerStatuses: []corev1.ContainerStatus{{
						State: corev1.ContainerState{
							Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"},
						},
					}},
				},
			},
			expected: "Init:CrashLoopBackOff",
		},
		{
			name: "init container terminated",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					InitContainerStatuses: []corev1.ContainerStatus{{
						State: corev1.ContainerState{
							Terminated: &corev1.ContainerStateTerminated{ExitCode: 1, Reason: "Error"},
						},
					}},
				},
			},
			expected: "Init:Error",
		},
		{
			name: "waiting container",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					ContainerStatuses: []corev1.ContainerStatus{{
						State: corev1.ContainerState{
							Waiting: &corev1.ContainerStateWaiting{Reason: "ImagePullBackOff"},
						},
					}},
				},
			},
			expected: "ImagePullBackOff",
		},
		{
			name: "terminated container",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					ContainerStatuses: []corev1.ContainerStatus{{
						State: corev1.ContainerState{
							Terminated: &corev1.ContainerStateTerminated{Reason: "Completed"},
						},
					}},
				},
			},
			expected: "Completed",
		},
		{
			name: "terminating pod",
			pod: corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					DeletionTimestamp: &metav1.Time{Time: time.Now()},
				},
			},
			expected: "Terminating",
		},
		{
			name: "phase fallback",
			pod: corev1.Pod{
				Status: corev1.PodStatus{Phase: corev1.PodPending},
			},
			expected: "Pending",
		},
		{
			name:     "unknown",
			pod:      corev1.Pod{},
			expected: "Unknown",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.expected, getPodStatus(tc.pod))
		})
	}
}

func TestBuildContainerDetailsFormatsPortsAndVolumes(t *testing.T) {
	container := corev1.Container{
		Name:  "web",
		Image: "demo:latest",
		Ports: []corev1.ContainerPort{{
			Name:          "http",
			ContainerPort: 8080,
			Protocol:      corev1.ProtocolTCP,
		}, {
			ContainerPort: 9090,
			Protocol:      corev1.ProtocolUDP,
		}},
		VolumeMounts: []corev1.VolumeMount{{
			Name:      "cfg",
			MountPath: "/etc/config",
			ReadOnly:  true,
			SubPath:   "default",
		}},
		Env: []corev1.EnvVar{{
			Name:  "ENV",
			Value: "prod",
		}, {
			Name: "FROM_SECRET",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "secret"}, Key: "token"},
			},
		}},
	}

	statuses := []corev1.ContainerStatus{{
		Name:  "web",
		Ready: true,
		State: corev1.ContainerState{
			Running: &corev1.ContainerStateRunning{StartedAt: metav1.Time{Time: time.Now().Add(-10 * time.Minute)}},
		},
	}}

	detail := buildContainerDetails(container, statuses, 0)
	require.Equal(t, []string{"8080 (http)", "9090/UDP"}, detail.Ports)
	require.Equal(t, []string{"cfg -> /etc/config (ro) [default]"}, detail.VolumeMounts)
	require.Equal(t, map[string]string{"ENV": "prod", "FROM_SECRET": "secret:secret/token"}, detail.Environment)
}

func TestResolveOwnerFallsBackToNone(t *testing.T) {
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "lonely",
			Namespace: "team-a",
		},
	}

	kind, name := ResolveOwner(pod, map[string]string{})
	require.Equal(t, "None", kind)
	require.Equal(t, "None", name)
}

func TestFormatHelpersHandleEmptyInputs(t *testing.T) {
	require.Empty(t, formatPodConditions(nil))
	require.Empty(t, formatPodVolumes(nil))
	require.Empty(t, formatPodTolerations(nil))
	require.Nil(t, buildAffinityMap(nil))
	require.Nil(t, buildSecurityContextMap(nil))
}

func TestFormatPodTolerationsIncludesSeconds(t *testing.T) {
	seconds := int64(30)
	result := formatPodTolerations([]corev1.Toleration{{
		Key:               "taint",
		Operator:          corev1.TolerationOpEqual,
		Value:             "value",
		Effect:            corev1.TaintEffectNoExecute,
		TolerationSeconds: &seconds,
	}})
	require.Equal(t, []string{"taint Equal value (NoExecute) for 30s"}, result)
}

func TestBuildAffinityAndSecurityContextMaps(t *testing.T) {
	runAsUser := int64(1000)
	runAsNonRoot := true
	affinity := &corev1.Affinity{
		NodeAffinity:    &corev1.NodeAffinity{},
		PodAffinity:     &corev1.PodAffinity{},
		PodAntiAffinity: &corev1.PodAntiAffinity{},
	}
	securityContext := &corev1.PodSecurityContext{
		RunAsUser:    &runAsUser,
		RunAsNonRoot: &runAsNonRoot,
	}

	affinityMap := buildAffinityMap(affinity)
	require.Equal(t, map[string]any{
		"nodeAffinity":    "configured",
		"podAffinity":     "configured",
		"podAntiAffinity": "configured",
	}, affinityMap)

	securityMap := buildSecurityContextMap(securityContext)
	require.Equal(t, map[string]any{
		"runAsUser":    runAsUser,
		"runAsNonRoot": runAsNonRoot,
	}, securityMap)
}

func TestBuildContainerDetailsFormatsProbes(t *testing.T) {
	container := corev1.Container{
		Name: "probe",
		ReadinessProbe: &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				HTTPGet: &corev1.HTTPGetAction{
					Path: "/ready",
					Port: intstr.FromInt(8080),
				},
			},
		},
	}
	detail := buildContainerDetails(container, nil, 0)
	require.Equal(t, "probe", detail.Name)
}

func buildPodMetrics(namespace, name string) *metricsv1beta1.PodMetrics {
	return &metricsv1beta1.PodMetrics{
		TypeMeta: metav1.TypeMeta{
			Kind:       "PodMetrics",
			APIVersion: "metrics.k8s.io/v1beta1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Containers: []metricsv1beta1.ContainerMetrics{{
			Name: name + "-container",
			Usage: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("100m"),
				corev1.ResourceMemory: resource.MustParse("64Mi"),
			},
		}},
	}
}

func strPtr(s string) *string { return &s }
func ptrBool(b bool) *bool    { return &b }
