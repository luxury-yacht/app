/*
 * backend/resources/nodes/wait_for_pods_test.go
 *
 * Tests for Pod termination wait helpers.
 * - Covers Pod termination wait helpers behavior and edge cases.
 */

package nodes

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestWaitForPodsToTerminateReturnsWhenNoneRemain(t *testing.T) {
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(fake.NewClientset()),
	))

	grace := 1
	options := types.DrainNodeOptions{GracePeriodSeconds: &grace}
	require.NoError(t, service.waitForPodsToTerminate("node-1", options))
}

func TestWaitForPodsToTerminateTimesOutWhenPodsRemain(t *testing.T) {
	pod := testsupport.PodFixture("default", "stuck-pod")
	pod.Spec.NodeName = "node-1"
	client := fake.NewClientset(pod)

	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	grace := 1
	options := types.DrainNodeOptions{GracePeriodSeconds: &grace}
	err := service.waitForPodsToTerminate("node-1", options)
	require.Error(t, err)
	require.Contains(t, err.Error(), "timed out")
}

func TestWaitForPodsToTerminateReturnsListError(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("list", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("pods list unavailable")
	})

	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	err := service.waitForPodsToTerminate("node-1", types.DrainNodeOptions{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to check remaining pods on node node-1")
	require.Contains(t, err.Error(), "pods list unavailable")
}
