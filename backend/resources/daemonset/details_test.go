/*
 * backend/resources/daemonset/details_test.go
 *
 * Tests for the DaemonSet detail service (co-located with the kind).
 */

package daemonset_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestDaemonSetServiceReturnsDetail(t *testing.T) {
	ds := testsupport.DaemonSetFixture("default", "agent")
	maxUnavailable := intstr.FromString("25%")
	maxSurge := intstr.FromInt(1)
	ds.Spec.UpdateStrategy = appsv1.DaemonSetUpdateStrategy{
		Type: appsv1.RollingUpdateDaemonSetStrategyType,
		RollingUpdate: &appsv1.RollingUpdateDaemonSet{
			MaxUnavailable: &maxUnavailable,
			MaxSurge:       &maxSurge,
		},
	}
	ds.Status.NumberUnavailable = 1
	ds.Status.NumberMisscheduled = 1
	// Distinct scheduling counts so the WorkloadCommonFacts projection is verified per-field.
	ds.Status.DesiredNumberScheduled = 5
	ds.Status.CurrentNumberScheduled = 4
	ds.Status.NumberReady = 3
	ds.Status.UpdatedNumberScheduled = 2
	ds.Status.NumberAvailable = 1
	ds.Status.Conditions = []appsv1.DaemonSetCondition{{
		Type:   appsv1.DaemonSetConditionType("PodsScheduled"),
		Status: corev1.ConditionTrue,
		Reason: "AllScheduled",
	}}
	pod := testsupport.PodFixture(
		"default",
		"agent-node",
		testsupport.PodWithOwner("DaemonSet", ds.Name, true),
		testsupport.PodWithLabels(ds.Spec.Selector.MatchLabels),
	)
	pod.Spec.NodeName = "node-b"
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "agent",
		Ready:        true,
		RestartCount: 2,
	}}

	client := cgofake.NewClientset(ds.DeepCopy(), pod.DeepCopy())
	deps := newDeps(t, client)

	service := daemonset.NewService(deps)
	detail, err := service.DaemonSet("default", "agent")
	require.NoError(t, err)
	require.Equal(t, "DaemonSet", detail.Kind)
	require.Len(t, detail.Pods, 1)
	require.Equal(t, int32(5), detail.Desired)
	require.Equal(t, int32(4), detail.Current)
	require.Equal(t, int32(3), detail.Ready)
	require.Equal(t, int32(2), detail.UpToDate)
	require.Equal(t, int32(1), detail.Available)
	require.Equal(t, "25%", detail.MaxUnavailable)
	require.Equal(t, "1", detail.MaxSurge)
	require.Contains(t, detail.Conditions, "PodsScheduled: True (AllScheduled)")
	require.Contains(t, detail.Details, "Misscheduled: 1")
}

func TestDaemonSetServiceProjectsNoEligibleNodesStatus(t *testing.T) {
	ds := testsupport.DaemonSetFixture("default", "agent")
	ds.Status = appsv1.DaemonSetStatus{}
	client := cgofake.NewClientset(ds.DeepCopy())

	detail, err := daemonset.NewService(newDeps(t, client)).DaemonSet("default", "agent")
	require.NoError(t, err)
	require.Equal(t, "No eligible nodes", detail.Status)
	require.Equal(t, "0/0", detail.StatusState)
	require.Equal(t, "warning", detail.StatusPresentation)
	require.Equal(t, "NoEligibleNodes", detail.StatusReason)
}

func newDeps(t testing.TB, client *cgofake.Clientset) common.Dependencies {
	t.Helper()
	return testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
}
