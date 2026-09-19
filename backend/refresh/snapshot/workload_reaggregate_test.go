package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Projected own fields survive serving while pod readiness, reservations and usage
// are joined. Expected values are explicit so removing the old combined builders
// does not make the test compare two calls to the same implementation.
func TestReaggregateWorkloadSummaryPreservesOwnFieldsAndJoinsPods(t *testing.T) {
	clusterID := "c-1"
	replicas := int32(3)

	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web", UID: "d-1", CreationTimestamp: metav1.Now()},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Ports: []corev1.ContainerPort{{ContainerPort: 8080}}}}}},
		},
		Status: appsv1.DeploymentStatus{ReadyReplicas: 2},
	}
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "db", UID: "s-1", CreationTimestamp: metav1.Now()},
		Spec: appsv1.StatefulSetSpec{
			Replicas: &replicas,
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "db"}}}},
		},
		Status: appsv1.StatefulSetStatus{ReadyReplicas: 3},
	}
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "agent", UID: "ds-1", CreationTimestamp: metav1.Now()},
		Spec:       appsv1.DaemonSetSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "agent"}}}}},
		Status:     appsv1.DaemonSetStatus{NumberReady: 4, DesiredNumberScheduled: 5},
	}
	completions := int32(6)
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Namespace: "batch", Name: "import", UID: "j-1", CreationTimestamp: metav1.Now()},
		Spec:       batchv1.JobSpec{Completions: &completions, Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "import"}}}}},
		Status:     batchv1.JobStatus{Succeeded: 2},
	}
	cron := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Namespace: "batch", Name: "nightly", UID: "cj-1", CreationTimestamp: metav1.Now()},
		Spec:       batchv1.CronJobSpec{JobTemplate: batchv1.JobTemplateSpec{Spec: batchv1.JobSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "nightly"}}}}}}},
		Status:     batchv1.CronJobStatus{Active: []corev1.ObjectReference{{Name: "nightly-123"}}},
	}

	// Two pods owned by the deployment: one fully ready, one not. Both carry container
	// resource reservations + restarts so the pod-join Restarts/resources differ from the
	// projected (zeroed) own-row, proving the re-join overlays them.
	depPods := []streamrows.PodAggregate{
		{
			Namespace: "team-a", Name: "web-a", Phase: string(corev1.PodRunning),
			ReadyContainers: 1, TotalContainers: 1, RestartCountFacts: 2,
			CPURequestMilli: 100, CPULimitMilli: 200, MemRequestBytes: 1 << 20, MemLimitBytes: 2 << 20,
			OwnerKey: workloadOwnerKey(deployment.Identity.Kind, "team-a", "web"),
		},
		{
			Namespace: "team-a", Name: "web-b", Phase: string(corev1.PodRunning),
			ReadyContainers: 0, TotalContainers: 1, RestartCountFacts: 1,
			CPURequestMilli: 50, CPULimitMilli: 100, MemRequestBytes: 1 << 19, MemLimitBytes: 1 << 20,
			OwnerKey: workloadOwnerKey(deployment.Identity.Kind, "team-a", "web"),
		},
	}
	jobPods := []streamrows.PodAggregate{
		{
			Namespace: "batch", Name: "import-x", Phase: string(corev1.PodRunning),
			ReadyContainers: 1, TotalContainers: 1, RestartCountFacts: 3,
			CPURequestMilli: 10, CPULimitMilli: 20, MemRequestBytes: 4096, MemLimitBytes: 8192,
			OwnerKey: workloadOwnerKey(jobres.Identity.Kind, "batch", "import"),
		},
	}
	usage := map[string]metrics.PodUsage{
		"team-a/web-a":   {CPUUsageMilli: 30, MemoryUsageBytes: 1 << 18},
		"team-a/web-b":   {CPUUsageMilli: 15, MemoryUsageBytes: 1 << 17},
		"batch/import-x": {CPUUsageMilli: 5, MemoryUsageBytes: 2048},
	}

	// A completed pod must contribute neither readiness nor resources/restarts.
	depPods = append(depPods, streamrows.PodAggregate{
		Namespace: "team-a", Name: "finished", Phase: string(corev1.PodSucceeded),
		ReadyContainers: 1, TotalContainers: 1, RestartCountFacts: 100,
		CPURequestMilli: 9999, CPULimitMilli: 9999, MemRequestBytes: 9999, MemLimitBytes: 9999,
	})
	cases := []struct {
		kind                           string
		own                            WorkloadSummary
		pods                           []streamrows.PodAggregate
		ready                          string
		restarts                       int32
		cpuUsage, cpuRequest, cpuLimit string
		memUsage, memRequest, memLimit string
	}{
		{deployment.Identity.Kind, buildDeploymentOwnSummary(clusterID, deploy), depPods, "1/2", 3, "45m", "150m", "300m", "384Ki", "2Mi", "3Mi"},
		{statefulset.Identity.Kind, buildStatefulSetOwnSummary(clusterID, sts), nil, "3/3", 0, "-", "-", "-", "-", "-", "-"},
		{daemonset.Identity.Kind, buildDaemonSetOwnSummary(clusterID, ds), nil, "4/5", 0, "-", "-", "-", "-", "-", "-"},
		{jobres.Identity.Kind, buildJobOwnSummary(clusterID, job), jobPods, "2/6", 3, "5m", "10m", "20m", "2Ki", "4Ki", "8Ki"},
		{cronjob.Identity.Kind, buildCronJobOwnSummary(clusterID, cron), nil, "1", 0, "-", "-", "-", "-", "-", "-"},
	}

	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			want := tc.own
			want.Ready, want.Restarts = tc.ready, tc.restarts
			want.CPUUsage, want.CPURequest, want.CPULimit = tc.cpuUsage, tc.cpuRequest, tc.cpuLimit
			want.MemUsage, want.MemRequest, want.MemLimit = tc.memUsage, tc.memRequest, tc.memLimit
			got := reaggregateWorkloadSummary(tc.own, tc.pods, usage)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("re-aggregation mismatch:\n got=%#v\nwant=%#v", got, want)
			}
			if tc.own.Restarts != 0 || tc.own.CPUUsage != "-" || tc.own.MemRequest != "-" {
				t.Fatalf("serve mutated the retained intake row: %#v", tc.own)
			}
		})
	}
}

func TestReaggregateWorkloadSummaryPreservesOutOfRangeReadyFallback(t *testing.T) {
	own := WorkloadSummary{Ref: resourcemodel.ResourceRef{Kind: deployment.Identity.Kind}, Ready: "2147483648/2147483649"}

	got := reaggregateWorkloadSummary(own, nil, nil)
	if got.Ready != own.Ready {
		t.Fatalf("ready fallback changed: got %q, want %q", got.Ready, own.Ready)
	}
}
