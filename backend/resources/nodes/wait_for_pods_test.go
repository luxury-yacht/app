package nodes

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	kubefake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestWaitForPodsToTerminateReturnsWhenNoneRemain(t *testing.T) {
	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(kubefake.NewClientset()),
	))

	options := types.DrainNodeOptions{GracePeriodSeconds: 1}
	require.NoError(t, service.waitForPodsToTerminate("node-1", options))
}

func TestWaitForPodsToTerminateTimesOutWhenPodsRemain(t *testing.T) {
	pod := testsupport.PodFixture("default", "stuck-pod")
	pod.Spec.NodeName = "node-1"
	client := kubefake.NewClientset(pod)

	service := NewService(testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	))

	options := types.DrainNodeOptions{GracePeriodSeconds: 1}
	err := service.waitForPodsToTerminate("node-1", options)
	require.Error(t, err)
	require.Contains(t, err.Error(), "timed out")
}
