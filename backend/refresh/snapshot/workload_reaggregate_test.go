package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
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

// TestReaggregateWorkloadSummaryMatchesTypedBuilder proves the serve-side re-join of a
// projected workload-own row with the owner's pods + metrics reproduces, byte for byte,
// the WorkloadSummary the typed buildXSummary builds directly from the typed object with
// the same pods + metrics. This is the core byte-equivalence guarantee of the cut: the
// own-fields come from the projection (built once at intake by the same builder with nil
// pods/usage), and the pod-join Ready/Restarts/resources + metrics CPU/Mem are re-joined
// at serve, so the post-cut row equals the pre-cut row.
func TestReaggregateWorkloadSummaryMatchesTypedBuilder(t *testing.T) {
	clusterID := "c-1"
	b := &NamespaceWorkloadsBuilder{}
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

	cases := []struct {
		kind string
		want WorkloadSummary
		own  WorkloadSummary
		pods []streamrows.PodAggregate
	}{
		{kind: deployment.Identity.Kind, want: deploymentWantSummary(b, clusterID, deploy, depPods, usage), own: b.buildDeploymentSummary(clusterID, deploy, nil, nil), pods: depPods},
		{kind: statefulset.Identity.Kind, want: b.buildStatefulSetSummary(clusterID, sts, nil, usage), own: b.buildStatefulSetSummary(clusterID, sts, nil, nil), pods: nil},
		{kind: daemonset.Identity.Kind, want: b.buildDaemonSetSummary(clusterID, ds, nil, usage), own: b.buildDaemonSetSummary(clusterID, ds, nil, nil), pods: nil},
		{kind: jobres.Identity.Kind, want: jobWantSummary(b, clusterID, job, jobPods, usage), own: b.buildJobSummary(clusterID, job, nil, nil), pods: jobPods},
		{kind: cronjob.Identity.Kind, want: b.buildCronJobSummary(clusterID, cron, nil, usage), own: b.buildCronJobSummary(clusterID, cron, nil, nil), pods: nil},
	}

	for _, tc := range cases {
		got := reaggregateWorkloadSummary(tc.own, tc.pods, usage)
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s re-aggregation mismatch:\n got=%#v\nwant=%#v", tc.kind, got, tc.want)
		}
	}
}

func TestReaggregateWorkloadSummaryPreservesOutOfRangeReadyFallback(t *testing.T) {
	own := WorkloadSummary{
		Kind:  deployment.Identity.Kind,
		Ready: "2147483648/2147483649",
	}

	got := reaggregateWorkloadSummary(own, nil, nil)
	if got.Ready != own.Ready {
		t.Fatalf("ready fallback changed: got %q, want %q", got.Ready, own.Ready)
	}
}

func deploymentWantSummary(b *NamespaceWorkloadsBuilder, clusterID string, deploy *appsv1.Deployment, pods []streamrows.PodAggregate, usage map[string]metrics.PodUsage) WorkloadSummary {
	byOwner := map[string][]streamrows.PodAggregate{workloadOwnerKey(deployment.Identity.Kind, deploy.Namespace, deploy.Name): pods}
	return b.buildDeploymentSummary(clusterID, deploy, byOwner, usage)
}

func jobWantSummary(b *NamespaceWorkloadsBuilder, clusterID string, job *batchv1.Job, pods []streamrows.PodAggregate, usage map[string]metrics.PodUsage) WorkloadSummary {
	byOwner := map[string][]streamrows.PodAggregate{workloadOwnerKey(jobres.Identity.Kind, job.Namespace, job.Name): pods}
	return b.buildJobSummary(clusterID, job, byOwner, usage)
}
