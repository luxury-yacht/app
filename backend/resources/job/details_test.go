/*
 * backend/resources/job/details_test.go
 *
 * Tests for the Job detail service (co-located with the kind).
 */

package job_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestJobServiceReturnsDetail(t *testing.T) {
	jobObj := testsupport.JobFixture("default", "report")
	jobObj.UID = types.UID("job-report")
	jobObj.Status.Active = 0
	jobObj.Status.Succeeded = 1
	jobObj.Status.Failed = 0
	completion := metav1.NewTime(time.Now())
	jobObj.Status.CompletionTime = &completion
	jobObj.Status.Conditions = []batchv1.JobCondition{{
		Type:   batchv1.JobComplete,
		Status: corev1.ConditionTrue,
		Reason: "Finished",
	}}
	jobObj.Spec.Completions = ptrInt32(1)
	jobObj.Spec.Parallelism = ptrInt32(1)
	jobObj.Spec.BackoffLimit = ptrInt32(2)

	pod := testsupport.PodFixture(
		"default",
		"report-worker",
		testsupport.PodWithOwner("Job", jobObj.Name, true),
		testsupport.PodWithLabels(jobObj.Spec.Selector.MatchLabels),
	)
	pod.OwnerReferences[0].UID = jobObj.UID
	pod.Status.Phase = corev1.PodSucceeded
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "worker",
		Ready:        true,
		RestartCount: 3,
	}}

	client := cgofake.NewClientset(jobObj.DeepCopy(), pod.DeepCopy())
	deps := newDeps(t, client)

	service := job.NewService(deps)
	detail, err := service.Job("default", "report")
	require.NoError(t, err)
	require.Equal(t, "Job", detail.Kind)
	require.Equal(t, int32(1), detail.Succeeded)
	require.Len(t, detail.Pods, 1)
	require.Equal(t, "Completed", detail.Status)
	require.Equal(t, int32(1), detail.Completions)
	require.Equal(t, int32(1), detail.Parallelism)
	require.Contains(t, detail.Conditions, "Complete: True (Finished)")
	require.Contains(t, detail.Details, "Succeeded: 1/1")
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
