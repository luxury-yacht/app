/*
 * backend/resources/workloads/services_test.go
 *
 * Tests for Service resource handlers.
 * - Covers Service resource handlers behavior and edge cases.
 */

package workloads_test

import (
	"context"
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
	kubefake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/workloads"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestStatefulSetServiceReturnsDetail(t *testing.T) {
	ss := testsupport.StatefulSetFixture("default", "db")
	partition := int32(1)
	maxUnavailable := intstr.FromInt(1)
	storageClass := "fast"

	ss.Spec.PodManagementPolicy = appsv1.ParallelPodManagement
	ss.Spec.MinReadySeconds = 15
	ss.Spec.UpdateStrategy = appsv1.StatefulSetUpdateStrategy{
		Type: appsv1.RollingUpdateStatefulSetStrategyType,
		RollingUpdate: &appsv1.RollingUpdateStatefulSetStrategy{
			Partition:      &partition,
			MaxUnavailable: &maxUnavailable,
		},
	}
	ss.Spec.PersistentVolumeClaimRetentionPolicy = &appsv1.StatefulSetPersistentVolumeClaimRetentionPolicy{
		WhenDeleted: appsv1.DeletePersistentVolumeClaimRetentionPolicyType,
		WhenScaled:  appsv1.RetainPersistentVolumeClaimRetentionPolicyType,
	}
	ss.Spec.VolumeClaimTemplates = []corev1.PersistentVolumeClaim{{
		ObjectMeta: metav1.ObjectMeta{Name: "data"},
		Spec: corev1.PersistentVolumeClaimSpec{
			StorageClassName: &storageClass,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: resource.MustParse("10Gi"),
				},
			},
		},
	}}
	ss.Status.Conditions = []appsv1.StatefulSetCondition{{
		Type:   appsv1.StatefulSetConditionType("Ready"),
		Status: corev1.ConditionTrue,
		Reason: "AllReplicasReady",
	}}

	podA := testsupport.PodFixture(
		"default",
		"db-0",
		testsupport.PodWithOwner("StatefulSet", ss.Name, true),
		testsupport.PodWithLabels(ss.Spec.Selector.MatchLabels),
	)
	podA.Spec.NodeName = "node-a"
	podA.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "app",
		Ready:        true,
		RestartCount: 1,
	}}

	podB := testsupport.PodFixture(
		"default",
		"db-1",
		testsupport.PodWithOwner("StatefulSet", ss.Name, true),
		testsupport.PodWithLabels(ss.Spec.Selector.MatchLabels),
	)
	podB.Spec.NodeName = "node-b"
	podB.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "app",
		Ready:        true,
		RestartCount: 0,
	}}

	client := kubefake.NewClientset(ss.DeepCopy(), podA.DeepCopy(), podB.DeepCopy())
	deps := newDeps(t, client)

	service := workloads.NewStatefulSetService(deps)
	detail, err := service.StatefulSet("default", "db")
	require.NoError(t, err)
	require.Equal(t, "StatefulSet", detail.Kind)
	require.Equal(t, "db", detail.Name)
	require.Len(t, detail.Pods, 2)
	require.Equal(t, "Parallel", detail.PodManagementPolicy)
	require.Equal(t, "RollingUpdate", detail.UpdateStrategy)
	require.Equal(t, "1", detail.MaxUnavailable)
	require.NotNil(t, detail.Partition)
	require.Equal(t, int32(1), *detail.Partition)
	require.Equal(t, map[string]string{"whenDeleted": "Delete", "whenScaled": "Retain"}, detail.PersistentVolumeClaimRetentionPolicy)
	require.Contains(t, detail.VolumeClaimTemplates, "data (fast) - 10Gi")
	require.Contains(t, detail.Conditions, "Ready: True (AllReplicasReady)")
	require.Equal(t, "Ready: 2/2, Service: db-svc, 1 PVC template(s)", detail.Details)
	require.Equal(t, "db", detail.Name)
}

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

	client := kubefake.NewClientset(ds.DeepCopy(), pod.DeepCopy())
	deps := newDeps(t, client)

	service := workloads.NewDaemonSetService(deps)
	detail, err := service.DaemonSet("default", "agent")
	require.NoError(t, err)
	require.Equal(t, "DaemonSet", detail.Kind)
	require.Len(t, detail.Pods, 1)
	require.Equal(t, "25%", detail.MaxUnavailable)
	require.Equal(t, "1", detail.MaxSurge)
	require.Contains(t, detail.Conditions, "PodsScheduled: True (AllScheduled)")
	require.Contains(t, detail.Details, "Misscheduled: 1")
}

func TestJobServiceReturnsDetail(t *testing.T) {
	job := testsupport.JobFixture("default", "report")
	job.UID = types.UID("job-report")
	job.Status.Active = 0
	job.Status.Succeeded = 1
	job.Status.Failed = 0
	completion := metav1.NewTime(timeNow())
	job.Status.CompletionTime = &completion
	job.Status.Conditions = []batchv1.JobCondition{{
		Type:   batchv1.JobComplete,
		Status: corev1.ConditionTrue,
		Reason: "Finished",
	}}
	job.Spec.Completions = int32Ptr(1)
	job.Spec.Parallelism = int32Ptr(1)
	job.Spec.BackoffLimit = int32Ptr(2)

	pod := testsupport.PodFixture(
		"default",
		"report-worker",
		testsupport.PodWithOwner("Job", job.Name, true),
		testsupport.PodWithLabels(job.Spec.Selector.MatchLabels),
	)
	pod.OwnerReferences[0].UID = job.UID
	pod.Status.Phase = corev1.PodSucceeded
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "worker",
		Ready:        true,
		RestartCount: 3,
	}}

	client := kubefake.NewClientset(job.DeepCopy(), pod.DeepCopy())
	deps := newDeps(t, client)

	service := workloads.NewJobService(deps)
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

	client := kubefake.NewClientset(cron.DeepCopy(), job.DeepCopy(), pod.DeepCopy())
	deps := newDeps(t, client)

	service := workloads.NewCronJobService(deps)
	detail, err := service.CronJob("default", "nightly")
	require.NoError(t, err)
	require.Equal(t, "CronJob", detail.Kind)
	require.NotEmpty(t, detail.ActiveJobs)
	require.Len(t, detail.Pods, 1)
	require.Equal(t, job.Name, detail.ActiveJobs[0].Name)
	require.NotNil(t, detail.ActiveJobs[0].StartTime)
	require.Equal(t, "Now", detail.NextScheduleTime)
	require.Equal(t, "0s", detail.TimeUntilNextSchedule)
	require.Contains(t, detail.Details, "Schedule: "+cron.Spec.Schedule)
}

func TestGetWorkloadsAggregatesKinds(t *testing.T) {
	deploy := testsupport.DeploymentFixture("default", "web")
	stateful := testsupport.StatefulSetFixture("default", "db")
	daemon := testsupport.DaemonSetFixture("default", "fluentd")
	job := testsupport.JobFixture("default", "report")
	job.UID = types.UID("job-report")
	cron := testsupport.CronJobFixture("default", "nightly")

	pods := []runtime.Object{
		testsupport.PodFixture("default", "web-0", testsupport.PodWithOwner("ReplicaSet", "web-rs", true), testsupport.PodWithLabels(deploy.Spec.Selector.MatchLabels)),
		testsupport.PodFixture("default", "db-0", testsupport.PodWithOwner("StatefulSet", stateful.Name, true), testsupport.PodWithLabels(stateful.Spec.Selector.MatchLabels)),
		testsupport.PodFixture("default", "fluentd-0", testsupport.PodWithOwner("DaemonSet", daemon.Name, true), testsupport.PodWithLabels(daemon.Spec.Selector.MatchLabels)),
		testsupport.PodFixture("default", "report-worker", testsupport.PodWithOwner("Job", job.Name, true), testsupport.PodWithLabels(job.Spec.Selector.MatchLabels)),
	}
	pods[3].(*corev1.Pod).OwnerReferences[0].UID = job.UID

	objects := append([]runtime.Object{
		deploy.DeepCopy(),
		stateful.DeepCopy(),
		daemon.DeepCopy(),
		job.DeepCopy(),
		cron.DeepCopy(),
	}, pods...)

	client := kubefake.NewClientset(objects...)
	deps := newDeps(t, client)

	results, err := workloads.GetWorkloads(deps, "default")
	require.NoError(t, err)

	kinds := make(map[string]bool)
	for _, info := range results {
		kinds[info.Kind] = true
	}

	require.True(t, kinds["Deployment"], "expected deployment workload present")
	require.True(t, kinds["StatefulSet"], "expected statefulset workload present")
	require.True(t, kinds["DaemonSet"], "expected daemonset workload present")
	require.True(t, kinds["Job"], "expected job workload present")
	require.True(t, kinds["CronJob"], "expected cronjob workload present")
}

func TestGetWorkloadsSortsAndSummarizes(t *testing.T) {
	deploy := testsupport.DeploymentFixture("default", "web")
	if deploy.Annotations == nil {
		deploy.Annotations = map[string]string{}
	}
	deploy.Annotations["deployment.kubernetes.io/revision"] = "1"
	deploy.Status.Replicas = 2
	deploy.Status.ReadyReplicas = 2
	deploy.Status.AvailableReplicas = 2

	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs",
			Namespace: "default",
			Labels:    deploy.Spec.Selector.MatchLabels,
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       deploy.Name,
				UID:        deploy.UID,
				Controller: ptrTo(true),
			}},
		},
		Spec: appsv1.ReplicaSetSpec{
			Selector: deploy.Spec.Selector,
			Template: deploy.Spec.Template,
		},
	}
	replicaSet.UID = types.UID("web-rs")

	stateful := testsupport.StatefulSetFixture("default", "db")
	daemon := testsupport.DaemonSetFixture("default", "fluentd")

	job := testsupport.JobFixture("default", "backup")
	job.Status.Active = 0
	job.Status.Succeeded = 1
	job.Status.Conditions = []batchv1.JobCondition{{
		Type:   batchv1.JobComplete,
		Status: corev1.ConditionTrue,
	}}
	job.Spec.Completions = int32Ptr(1)
	job.Spec.Parallelism = int32Ptr(1)

	cron := testsupport.CronJobFixture("default", "nightly")

	pods := []runtime.Object{
		testsupport.PodFixture(
			"default",
			"web-0",
			testsupport.PodWithOwner("ReplicaSet", replicaSet.Name, true),
			testsupport.PodWithLabels(deploy.Spec.Selector.MatchLabels),
		),
		testsupport.PodFixture(
			"default",
			"db-0",
			testsupport.PodWithOwner("StatefulSet", stateful.Name, true),
			testsupport.PodWithLabels(stateful.Spec.Selector.MatchLabels),
		),
		testsupport.PodFixture(
			"default",
			"fluentd-0",
			testsupport.PodWithOwner("DaemonSet", daemon.Name, true),
			testsupport.PodWithLabels(daemon.Spec.Selector.MatchLabels),
		),
		testsupport.PodFixture(
			"default",
			"backup-worker",
			testsupport.PodWithOwner("Job", job.Name, true),
			testsupport.PodWithLabels(job.Spec.Selector.MatchLabels),
		),
	}

	pods[0].(*corev1.Pod).OwnerReferences[0].UID = replicaSet.UID
	pods[1].(*corev1.Pod).OwnerReferences[0].UID = stateful.UID
	pods[2].(*corev1.Pod).OwnerReferences[0].UID = daemon.UID
	pods[3].(*corev1.Pod).OwnerReferences[0].UID = job.UID

	pods[0].(*corev1.Pod).Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "web", Ready: true, RestartCount: 1}}
	pods[1].(*corev1.Pod).Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "db", Ready: true, RestartCount: 0}}
	pods[2].(*corev1.Pod).Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "fluentd", Ready: true, RestartCount: 0}}
	pods[3].(*corev1.Pod).Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "worker", Ready: true, RestartCount: 3}}
	pods[3].(*corev1.Pod).Status.Phase = corev1.PodSucceeded

	objects := append([]runtime.Object{
		deploy.DeepCopy(),
		replicaSet.DeepCopy(),
		stateful.DeepCopy(),
		daemon.DeepCopy(),
		job.DeepCopy(),
		cron.DeepCopy(),
	}, pods...)

	client := kubefake.NewClientset(objects...)

	ensureCalled := false
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error {
			ensureCalled = true
			return nil
		}),
	)

	results, err := workloads.GetWorkloads(deps, "default")
	require.NoError(t, err)
	require.True(t, ensureCalled, "expected EnsureClient to be invoked")

	var kinds []string
	for _, info := range results {
		kinds = append(kinds, info.Kind)
	}
	require.Equal(t, []string{"CronJob", "DaemonSet", "Deployment", "Job", "StatefulSet"}, kinds)

	var jobInfo, deployInfo *workloads.WorkloadInfo
	for _, info := range results {
		switch info.Kind {
		case "Job":
			jobInfo = info
		case "Deployment":
			deployInfo = info
		}
	}

	require.NotNil(t, jobInfo)
	require.Equal(t, int32(3), jobInfo.Restarts)
	require.Equal(t, "Completed", jobInfo.Status)

	require.NotNil(t, deployInfo)
	require.Equal(t, "2/2", deployInfo.Ready)
	require.Equal(t, "Running", deployInfo.Status)
}

func newDeps(t testing.TB, client *kubefake.Clientset) common.Dependencies {
	t.Helper()
	return testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
}

func timeNow() time.Time {
	return time.Now()
}

func ptrTo(val bool) *bool {
	return &val
}

func int32Ptr(val int32) *int32 {
	return &val
}
