/*
 * backend/resources/nodes/nodes_internal_test.go
 *
 * Tests for Node internal helpers.
 * - Covers Node internal helpers behavior and edge cases.
 */

package nodes

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	cgofake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	cgotesting "k8s.io/client-go/testing"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestDrainHelperTimeoutMatchesKubectlDefault(t *testing.T) {
	require.Zero(t, drainHelperTimeout(restypes.DrainNodeOptions{}))

	zero := 0
	require.Zero(t, drainHelperTimeout(restypes.DrainNodeOptions{TimeoutSeconds: &zero}))

	custom := 300
	require.Equal(t, 5*time.Minute, drainHelperTimeout(restypes.DrainNodeOptions{TimeoutSeconds: &custom}))
}

func TestStartDrainWithCompletionPassesCreatedJobID(t *testing.T) {
	deps := testsupport.NewResourceDependencies(testsupport.WithDepsKubeClient(cgofake.NewClientset()))
	deps.ClusterID = "cluster-a-" + t.Name()
	deps.ClusterName = "Cluster A"
	service := NewService(deps)
	completed := make(chan string, 1)

	job, err := service.StartDrainWithCompletion("missing-"+t.Name(), restypes.DrainNodeOptions{}, func(jobID string) {
		completed <- jobID
	})
	require.NoError(t, err)

	select {
	case jobID := <-completed:
		require.Equal(t, job.ID, jobID)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for drain completion callback")
	}
}

func TestEnsureMetricsClientInitializesClient(t *testing.T) {
	setterCalled := false
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsRestConfig(&rest.Config{Host: "https://example.com", TLSClientConfig: rest.TLSClientConfig{Insecure: true}}),
		testsupport.WithDepsSetMetrics(func(metricsclient.Interface) { setterCalled = true }),
	)
	service := NewService(deps)

	service.ensureMetricsClient()

	require.True(t, setterCalled, "metrics setter should fire when rest config is available")
	require.NotNil(t, service.deps.MetricsClient)
}

func TestGetNodeMetricsReturnsUsage(t *testing.T) {
	metrics := &metricsv1beta1.NodeMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Usage: map[corev1.ResourceName]resource.Quantity{
			corev1.ResourceCPU:    resource.MustParse("250m"),
			corev1.ResourceMemory: resource.MustParse("512Mi"),
		},
	}

	client := metricsfake.NewSimpleClientset(metrics)
	client.Fake.PrependReactor("*", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		if get, ok := action.(cgotesting.GetAction); ok && get.GetName() == "node-1" {
			return true, metrics, nil
		}
		return false, nil, nil
	})

	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsMetricsClient(client)))

	usage := service.getNodeMetrics("node-1")
	require.NotNil(t, usage)
	cpu := usage[corev1.ResourceCPU]
	mem := usage[corev1.ResourceMemory]
	require.Equal(t, "250m", cpu.String())
	require.Equal(t, "512Mi", mem.String())
}

func TestBuildNodeDetailsAggregatesOnlyActivePodResources(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
		Status: corev1.NodeStatus{
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:              resource.MustParse("8"),
				corev1.ResourceMemory:           resource.MustParse("16Gi"),
				corev1.ResourcePods:             resource.MustParse("110"),
				corev1.ResourceEphemeralStorage: resource.MustParse("100Gi"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("7500m"),
				corev1.ResourceMemory: resource.MustParse("15Gi"),
				corev1.ResourcePods:   resource.MustParse("100"),
			},
		},
	}

	tests := []struct {
		name            string
		phase           corev1.PodPhase
		wantCPURequests string
		wantCPULimits   string
		wantMemRequests string
		wantMemLimits   string
	}{
		{name: "running", phase: corev1.PodRunning, wantCPURequests: "350m", wantCPULimits: "600m", wantMemRequests: "1.5 GB", wantMemLimits: "3.0 GB"},
		{name: "pending", phase: corev1.PodPending, wantCPURequests: "350m", wantCPULimits: "600m", wantMemRequests: "1.5 GB", wantMemLimits: "3.0 GB"},
		{name: "succeeded", phase: corev1.PodSucceeded, wantCPURequests: "0m", wantCPULimits: "0m", wantMemRequests: "0Mi", wantMemLimits: "0Mi"},
		{name: "failed", phase: corev1.PodFailed, wantCPURequests: "0m", wantCPULimits: "0m", wantMemRequests: "0Mi", wantMemLimits: "0Mi"},
		{name: "unknown", phase: corev1.PodUnknown, wantCPURequests: "0m", wantCPULimits: "0m", wantMemRequests: "0Mi", wantMemLimits: "0Mi"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pod := corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: tt.name, Namespace: "workloads"},
				Spec: corev1.PodSpec{Containers: []corev1.Container{
					{Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m")},
						Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2Gi")},
					}},
					{Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("250m"), corev1.ResourceMemory: resource.MustParse("1536Mi")},
						Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("600m"), corev1.ResourceMemory: resource.MustParse("1Gi")},
					}},
					{},
				}},
				Status: corev1.PodStatus{
					Phase:             tt.phase,
					ContainerStatuses: []corev1.ContainerStatus{{RestartCount: 3}},
				},
			}
			deps := testsupport.NewResourceDependencies()
			deps.ClusterID = "cluster-a"
			details := NewService(deps).buildNodeDetails(node, []corev1.Pod{pod}, nil)

			require.Equal(t, tt.wantCPURequests, details.CPURequests)
			require.Equal(t, tt.wantCPULimits, details.CPULimits)
			require.Equal(t, tt.wantMemRequests, details.MemRequests)
			require.Equal(t, tt.wantMemLimits, details.MemLimits)
			require.Equal(t, int32(3), details.Restarts)
			require.Len(t, details.PodsList, 1)
			require.Equal(t, tt.name, details.PodsList[0].Name)
		})
	}
}

func TestBuildNodeDetailsPreservesProjectionOrderingAndDefaults(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "node-a",
			Labels:      map[string]string{"node-role.kubernetes.io/control-plane": "", "node-role.kubernetes.io/gpu": ""},
			Annotations: map[string]string{"example": "value"},
		},
		Spec: corev1.NodeSpec{Taints: []corev1.Taint{
			{Key: "dedicated", Value: "gpu", Effect: corev1.TaintEffectNoSchedule},
			{Key: "maintenance", Effect: corev1.TaintEffectNoExecute},
		}},
		Status: corev1.NodeStatus{
			NodeInfo: corev1.NodeSystemInfo{
				Architecture:            "arm64",
				OperatingSystem:         "linux",
				OSImage:                 "Flatcar",
				KernelVersion:           "6.6",
				ContainerRuntimeVersion: "containerd://2",
				KubeletVersion:          "v1.31.0",
			},
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionFalse, Reason: "EnoughMemory", Message: "ok"},
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue, Reason: "KubeletReady"},
			},
			Addresses: []corev1.NodeAddress{
				{Type: corev1.NodeInternalIP, Address: "10.0.0.1"},
				{Type: corev1.NodeExternalIP, Address: "203.0.113.2"},
				{Type: corev1.NodeHostName, Address: "node-a.local"},
			},
		},
	}
	usage := corev1.ResourceList{
		corev1.ResourceCPU:    resource.MustParse("333m"),
		corev1.ResourceMemory: resource.MustParse("768Mi"),
	}
	details := NewService(testsupport.NewResourceDependencies()).buildNodeDetails(node, nil, usage)

	require.Equal(t, "node", details.Kind)
	require.Equal(t, "control-plane,gpu", details.Roles)
	require.Equal(t, "10.0.0.1", details.InternalIP)
	require.Equal(t, "203.0.113.2", details.ExternalIP)
	require.Equal(t, "node-a.local", details.Hostname)
	require.Equal(t, "333m", details.CPUUsage)
	require.Equal(t, "768 MB", details.MemoryUsage)
	require.Equal(t, "0/", details.Pods)
	require.Nil(t, details.PodsList)
	require.Equal(t, []NodeCondition{
		{Kind: "MemoryPressure", Status: "False", Reason: "EnoughMemory", Message: "ok"},
		{Kind: "Ready", Status: "True", Reason: "KubeletReady"},
	}, details.Conditions)
	require.Equal(t, []NodeTaint{
		{Key: "dedicated", Value: "gpu", Effect: "NoSchedule"},
		{Key: "maintenance", Effect: "NoExecute"},
	}, details.Taints)
}

type recordingLogger struct {
	infoCalled  bool
	errorCalled bool
}

func (l *recordingLogger) Debug(string, ...string) {}
func (l *recordingLogger) Info(string, ...string)  { l.infoCalled = true }
func (l *recordingLogger) Warn(string, ...string)  {}
func (l *recordingLogger) Error(string, ...string) { l.errorCalled = true }

func TestLogHelpersUseLogger(t *testing.T) {
	logger := &recordingLogger{}
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsLogger(logger)))

	service.logInfo("info")
	service.logError(errors.New("boom"), "error", "get")

	require.True(t, logger.infoCalled)
	require.True(t, logger.errorCalled)
}
