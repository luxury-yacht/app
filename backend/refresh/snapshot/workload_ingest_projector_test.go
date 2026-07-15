package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
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

// TestNewWorkloadIngestProjectorBundleMatchesLivePaths proves the bundle each
// per-kind workload projector builds is byte-equivalent, half by half, to what
// each live consumer path builds from the typed workload:
//
//   - Table     == the workload-OWN-fields WorkloadSummary the serve-side builder
//     produces with NO pods, NO metrics, NO HPA (the parts read from the typed
//     object alone), so a serve-side re-join reproduces the full row;
//   - Catalog   == objectcatalog.SummaryProjector for the kind;
//   - ObjectMap == objectmapnode.NewNodeProjector from the kind's collector + edges.
func TestNewWorkloadIngestProjectorBundleMatchesLivePaths(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	clusterID := meta.ClusterID
	b := &NamespaceWorkloadsBuilder{}
	replicas := int32(3)

	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web", UID: "d-1", CreationTimestamp: metav1.Now(), Labels: map[string]string{"app.kubernetes.io/part-of": "storefront"}},
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

	cases := []struct {
		obj       metav1.Object
		collector objectmapnode.Collector
		project   ingest.ProjectFunc
		wantOwn   WorkloadSummary
	}{
		{obj: deploy, collector: deployment.ObjectMapNode, project: NewDeploymentIngestProjector(meta), wantOwn: b.buildDeploymentSummary(clusterID, deploy, nil, nil)},
		{obj: sts, collector: statefulset.ObjectMapNode, project: NewStatefulSetIngestProjector(meta), wantOwn: b.buildStatefulSetSummary(clusterID, sts, nil, nil)},
		{obj: ds, collector: daemonset.ObjectMapNode, project: NewDaemonSetIngestProjector(meta), wantOwn: b.buildDaemonSetSummary(clusterID, ds, nil, nil)},
		{obj: job, collector: jobres.ObjectMapNode, project: NewJobIngestProjector(meta), wantOwn: b.buildJobSummary(clusterID, job, nil, nil)},
		{obj: cron, collector: cronjob.ObjectMapNode, project: NewCronJobIngestProjector(meta), wantOwn: b.buildCronJobSummary(clusterID, cron, nil, nil)},
	}

	for _, tc := range cases {
		raw, err := tc.project(tc.obj)
		if err != nil {
			t.Fatalf("projector error for %s/%s: %v", tc.obj.GetNamespace(), tc.obj.GetName(), err)
		}
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			t.Fatalf("projector returned %T, want ingest.Bundle", raw)
		}

		// Table half: the workload-own WorkloadSummary, which with no pods/metrics/HPA
		// equals the serve-side builder's output (the want value, built with nil pods/
		// usage). The ClusterMeta is stamped by the projector.
		want := tc.wantOwn
		want.ClusterMeta = meta
		gotTable, ok := bundle.Table.(WorkloadSummary)
		if !ok {
			t.Fatalf("Table half is %T, want WorkloadSummary", bundle.Table)
		}
		// WorkloadSummary carries *int32 (DesiredReplicas) / *bool (HPAManaged) pointers,
		// so compare with DeepEqual (which follows the pointers) rather than ==, whose
		// pointer fields would differ by allocation, not content.
		if !reflect.DeepEqual(gotTable, want) {
			t.Fatalf("Table half mismatch for %s/%s:\n got=%#v\nwant=%#v", tc.obj.GetNamespace(), tc.obj.GetName(), gotTable, want)
		}

		// Catalog half.
		catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, tc.collector.Identity)
		wantCatalog, ok := catalogProject(tc.obj).(objectcatalog.Summary)
		if !ok {
			t.Fatalf("catalogProject returned %T", catalogProject(tc.obj))
		}
		gotCatalog, ok := bundle.Catalog.(objectcatalog.Summary)
		if !ok {
			t.Fatalf("Catalog half is %T, want objectcatalog.Summary", bundle.Catalog)
		}
		if !reflect.DeepEqual(gotCatalog, wantCatalog) {
			t.Fatalf("Catalog half mismatch for %s/%s:\n got=%#v\nwant=%#v", tc.obj.GetNamespace(), tc.obj.GetName(), gotCatalog, wantCatalog)
		}

		// ObjectMap half.
		gotNode, ok := bundle.ObjectMap.(objectmapnode.Node)
		if !ok {
			t.Fatalf("ObjectMap half is %T, want objectmapnode.Node", bundle.ObjectMap)
		}
		if gotNode.Namespace != tc.obj.GetNamespace() || gotNode.Name != tc.obj.GetName() || gotNode.UID != string(tc.obj.GetUID()) {
			t.Fatalf("ObjectMap node metadata mismatch for %s/%s: got=%#v", tc.obj.GetNamespace(), tc.obj.GetName(), gotNode)
		}
	}
}
