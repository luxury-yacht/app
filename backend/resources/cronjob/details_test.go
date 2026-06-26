/*
 * backend/resources/cronjob/details_test.go
 *
 * Tests for the CronJob detail service (co-located with the kind).
 */

package cronjob_test

import (
	"context"
	"testing"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestCronJobServiceCollectsPods(t *testing.T) {
	cron := testsupport.CronJobFixture("default", "nightly")
	cron.UID = types.UID("cron-nightly")
	cron.Status.LastScheduleTime = &metav1.Time{Time: timeNow().Add(-5 * time.Minute)}
	cron.Status.LastSuccessfulTime = &metav1.Time{Time: timeNow().Add(-15 * time.Minute)}

	job := testsupport.JobFixture("default", "nightly-001")
	job.UID = types.UID("job-nightly-001")
	job.OwnerReferences = []metav1.OwnerReference{{
		APIVersion: "batch/v1",
		Kind:       "CronJob",
		Name:       cron.Name,
		UID:        cron.UID,
		Controller: ptrTo(true),
	}}
	start := metav1.NewTime(timeNow().Add(-2 * time.Minute))
	job.Status.StartTime = &start
	cron.Status.Active = []corev1.ObjectReference{{
		Kind:      "Job",
		Name:      job.Name,
		Namespace: cron.Namespace,
		UID:       job.UID,
	}}

	pod := testsupport.PodFixture(
		"default",
		"nightly-001-abc",
		testsupport.PodWithOwner("Job", job.Name, true),
		testsupport.PodWithLabels(job.Spec.Selector.MatchLabels),
	)
	pod.OwnerReferences[0].UID = job.UID
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "cron",
		Ready:        true,
		RestartCount: 0,
	}}

	client := cgofake.NewClientset(cron.DeepCopy(), job.DeepCopy(), pod.DeepCopy())
	deps := newDeps(t, client)

	service := cronjob.NewService(deps)
	detail, err := service.CronJob("default", "nightly")
	require.NoError(t, err)
	require.Equal(t, "CronJob", detail.Kind)
	require.NotEmpty(t, detail.ActiveJobs)
	require.Len(t, detail.Pods, 1)
	require.Equal(t, job.Name, detail.ActiveJobs[0].Name)
	require.NotNil(t, detail.ActiveJobs[0].StartTime)
	// `*/5 * * * *` always has a future fire-time within 5 minutes of any
	// "now", so we expect a parseable RFC3339 value and a non-empty
	// "until" duration. Exact values are clock-dependent.
	require.NotEmpty(t, detail.NextScheduleTime)
	_, err = time.Parse(time.RFC3339, detail.NextScheduleTime)
	require.NoError(t, err)
	require.NotEmpty(t, detail.TimeUntilNextSchedule)
	require.Contains(t, detail.Details, "Schedule: "+cron.Spec.Schedule)
}

func TestCronJobServiceComputesNextScheduleBeforeFirstRun(t *testing.T) {
	cron := testsupport.CronJobFixture("default", "nightly")
	require.Nil(t, cron.Status.LastScheduleTime)

	client := cgofake.NewClientset(cron.DeepCopy())
	deps := newDeps(t, client)

	service := cronjob.NewService(deps)
	detail, err := service.CronJob("default", "nightly")
	require.NoError(t, err)
	require.NotEmpty(t, detail.NextScheduleTime)
	_, err = time.Parse(time.RFC3339, detail.NextScheduleTime)
	require.NoError(t, err)
	require.NotEmpty(t, detail.TimeUntilNextSchedule)
}

func TestCronJobServiceUsesSpecTimeZoneForNextSchedule(t *testing.T) {
	tz := "UTC"
	cronJob := testsupport.CronJobFixture("default", "nightly")
	cronJob.Spec.Schedule = "0 0 * * *"
	cronJob.Spec.TimeZone = &tz

	before := time.Now()
	client := cgofake.NewClientset(cronJob.DeepCopy())
	deps := newDeps(t, client)

	service := cronjob.NewService(deps)
	detail, err := service.CronJob("default", "nightly")
	after := time.Now()
	require.NoError(t, err)
	require.NotEmpty(t, detail.NextScheduleTime)

	got, err := time.Parse(time.RFC3339, detail.NextScheduleTime)
	require.NoError(t, err)
	schedule, err := cron.ParseStandard("TZ=UTC " + cronJob.Spec.Schedule)
	require.NoError(t, err)
	nextBefore := schedule.Next(before)
	nextAfter := schedule.Next(after)
	require.Truef(t, got.Equal(nextBefore) || got.Equal(nextAfter), "got %s, expected %s or %s", got, nextBefore, nextAfter)
}

func TestCronJobServiceCollectsJobs(t *testing.T) {
	cron := testsupport.CronJobFixture("default", "nightly")
	cron.UID = types.UID("cron-nightly")

	// Create two jobs owned by the cronjob: one completed, one running.
	completedCreated := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	completedJob := testsupport.JobFixture("default", "nightly-001")
	completedJob.UID = types.UID("job-001")
	completedJob.CreationTimestamp = metav1.NewTime(completedCreated)
	completedJob.OwnerReferences = []metav1.OwnerReference{{
		APIVersion: "batch/v1",
		Kind:       "CronJob",
		Name:       cron.Name,
		UID:        cron.UID,
		Controller: ptrTo(true),
	}}
	completedJob.Status.Succeeded = 1
	completedJob.Status.StartTime = &metav1.Time{Time: timeNow().Add(-10 * time.Minute)}
	completedJob.Status.CompletionTime = &metav1.Time{Time: timeNow().Add(-8 * time.Minute)}

	runningCreated := time.Date(2026, 1, 2, 3, 5, 5, 0, time.UTC)
	runningJob := testsupport.JobFixture("default", "nightly-002")
	runningJob.UID = types.UID("job-002")
	runningJob.CreationTimestamp = metav1.NewTime(runningCreated)
	runningJob.OwnerReferences = []metav1.OwnerReference{{
		APIVersion: "batch/v1",
		Kind:       "CronJob",
		Name:       cron.Name,
		UID:        cron.UID,
		Controller: ptrTo(true),
	}}
	runningJob.Status.Active = 1
	runningJob.Status.StartTime = &metav1.Time{Time: timeNow().Add(-1 * time.Minute)}

	// Create a job NOT owned by the cronjob — should be excluded.
	unrelatedJob := testsupport.JobFixture("default", "other-job")
	unrelatedJob.UID = types.UID("job-other")

	client := cgofake.NewClientset(cron.DeepCopy(), completedJob.DeepCopy(), runningJob.DeepCopy(), unrelatedJob.DeepCopy())
	deps := newDeps(t, client)

	service := cronjob.NewService(deps)
	detail, err := service.CronJob("default", "nightly")
	require.NoError(t, err)

	// Verify jobs are collected and unrelated job is filtered out.
	require.Len(t, detail.Jobs, 2, "should include exactly the two owned jobs")

	// Find the completed and running jobs by name.
	jobsByName := make(map[string]struct {
		Status       string
		Completions  string
		AgeTimestamp int64
	})
	for _, j := range detail.Jobs {
		require.Equal(t, "Job", j.Kind)
		require.Equal(t, "default", j.Namespace)
		jobsByName[j.Name] = struct {
			Status       string
			Completions  string
			AgeTimestamp int64
		}{j.Status, j.Completions, j.AgeTimestamp}
	}

	require.Contains(t, jobsByName, "nightly-001")
	require.Equal(t, "Completed", jobsByName["nightly-001"].Status)
	require.Equal(t, "1/1", jobsByName["nightly-001"].Completions)
	require.Equal(t, completedCreated.UnixMilli(), jobsByName["nightly-001"].AgeTimestamp)

	require.Contains(t, jobsByName, "nightly-002")
	require.Equal(t, "Running", jobsByName["nightly-002"].Status)
	require.Equal(t, "0/1", jobsByName["nightly-002"].Completions)
	require.Equal(t, runningCreated.UnixMilli(), jobsByName["nightly-002"].AgeTimestamp)
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

func timeNow() time.Time {
	return time.Now()
}

func ptrTo(val bool) *bool {
	return &val
}
