/*
 * backend/resources/nodes/nodes_internal_test.go
 *
 * Tests for Node internal helpers.
 * - Covers Node internal helpers behavior and edge cases.
 */

package nodes

import (
	"fmt"
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

func TestListNodeMetricsHandlesAPIErrors(t *testing.T) {
	client := metricsfake.NewSimpleClientset()
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsMetricsClient(client)))

	client.Fake.PrependReactor("*", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("list failed")
	})

	require.Nil(t, service.listNodeMetrics())
}

func TestListNodeMetricsReturnsValues(t *testing.T) {
	metrics := &metricsv1beta1.NodeMetrics{
		TypeMeta:   metav1.TypeMeta{Kind: "NodeMetrics", APIVersion: "metrics.k8s.io/v1beta1"},
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Usage: map[corev1.ResourceName]resource.Quantity{
			corev1.ResourceCPU:    resource.MustParse("100m"),
			corev1.ResourceMemory: resource.MustParse("256Mi"),
		},
	}

	client := metricsfake.NewSimpleClientset(metrics)
	client.Fake.PrependReactor("*", "*", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, &metricsv1beta1.NodeMetricsList{Items: []metricsv1beta1.NodeMetrics{*metrics}}, nil
	})
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsMetricsClient(client)))

	result := service.listNodeMetrics()
	require.Contains(t, result, "node-1")
	cpu := result["node-1"][corev1.ResourceCPU]
	mem := result["node-1"][corev1.ResourceMemory]
	require.Equal(t, "100m", cpu.String())
	require.Equal(t, "256Mi", mem.String())
}

func TestListAllPodsByNodeGroupsPods(t *testing.T) {
	podOne := testsupport.PodFixture("default", "pod-1")
	podOne.Spec.NodeName = "node-1"
	podTwo := testsupport.PodFixture("default", "pod-2")
	podTwo.Spec.NodeName = "node-1"
	ignored := testsupport.PodFixture("default", "pod-ignored")
	ignored.Spec.NodeName = ""

	client := cgofake.NewClientset(podOne, podTwo, ignored)
	service := NewService(testsupport.NewResourceDependencies(testsupport.WithDepsKubeClient(client)))

	result := service.listAllPodsByNode()
	require.Len(t, result, 1)
	require.Len(t, result["node-1"], 2)
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
	service.logError("error")

	require.True(t, logger.infoCalled)
	require.True(t, logger.errorCalled)
}
