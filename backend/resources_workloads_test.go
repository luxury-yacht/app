/*
 * backend/resources_workloads_wrappers_test.go
 *
 * Tests for workload wrapper handlers.
 * - Covers workload wrapper behavior and edge cases.
 */

package backend

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/versioning"
)

func TestGetWorkloadsRequiresClient(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.versionCache = versioning.NewCache()

	_, err := app.GetWorkloads("default", "")
	if err == nil {
		t.Fatalf("expected error when client not initialised")
	}
}

func TestGetWorkloadsReturnsData(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.versionCache = versioning.NewCache()

	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			Labels:    map[string]string{"app": "web"},
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "web"}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "web", Image: "nginx"}},
				},
			},
		},
		Status: appsv1.DeploymentStatus{ReadyReplicas: 1, Replicas: 1},
	}
	app.client = cgofake.NewClientset(deploy)

	resp, err := app.GetWorkloads("default", "")
	if err != nil {
		t.Fatalf("expected workloads to succeed: %v", err)
	}
	if resp == nil || resp.Data == nil {
		t.Fatalf("expected workload data, got %+v", resp)
	}
}

func TestWorkloadWrappersHappyPath(t *testing.T) {
	app := wrapperTestApp(t)
	app.Ctx = context.Background()

	labels := map[string]string{"app": "web"}
	replicas := int32(1)
	revisionHistory := int32(1)

	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "apps"},
		Spec: appsv1.DeploymentSpec{
			Replicas:             &replicas,
			RevisionHistoryLimit: &revisionHistory,
			Selector:             &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: "nginx"}}},
			},
		},
		Status: appsv1.DeploymentStatus{ReadyReplicas: 1, Replicas: 1},
	}
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web-rs",
			Namespace:       "apps",
			Labels:          labels,
			OwnerReferences: []metav1.OwnerReference{{Kind: "Deployment", Name: "web"}},
		},
		Spec: appsv1.ReplicaSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: labels},
		},
		Status: appsv1.ReplicaSetStatus{ReadyReplicas: 1},
	}
	stsReplicas := int32(1)
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "apps"},
		Spec: appsv1.StatefulSetSpec{
			Replicas:    &stsReplicas,
			ServiceName: "db",
			Selector:    &metav1.LabelSelector{MatchLabels: map[string]string{"app": "db"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "db"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "db", Image: "postgres"}}},
			},
		},
		Status: appsv1.StatefulSetStatus{ReadyReplicas: 1, Replicas: 1},
	}
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: "logger", Namespace: "apps"},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "logger"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "logger"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "fluentd", Image: "fluentd"}}},
			},
		},
		Status: appsv1.DaemonSetStatus{NumberReady: 1, DesiredNumberScheduled: 1},
	}

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "backup", Namespace: "apps"},
		Spec: batchv1.JobSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"job-name": "backup"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"job-name": "backup"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "backup", Image: "alpine"}}, RestartPolicy: corev1.RestartPolicyNever},
			},
		},
		Status: batchv1.JobStatus{Succeeded: 1},
	}

	cronJob := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: "nightly", Namespace: "apps"},
		Spec: batchv1.CronJobSpec{
			Schedule: "0 2 * * *",
			JobTemplate: batchv1.JobTemplateSpec{
				Spec: batchv1.JobSpec{
					Template: corev1.PodTemplateSpec{
						Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "job", Image: "alpine"}}, RestartPolicy: corev1.RestartPolicyNever},
					},
				},
			},
		},
		Status: batchv1.CronJobStatus{LastScheduleTime: &metav1.Time{}},
	}

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-abc", Namespace: "apps", Labels: labels, OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "web-rs"}}},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "db-0", Namespace: "apps", Labels: map[string]string{"app": "db"}, OwnerReferences: []metav1.OwnerReference{{Kind: "StatefulSet", Name: "db"}}},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "db"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "logger-abc", Namespace: "apps", Labels: map[string]string{"app": "logger"}, OwnerReferences: []metav1.OwnerReference{{Kind: "DaemonSet", Name: "logger"}}},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "logger"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "backup-1", Namespace: "apps", Labels: map[string]string{"job-name": "backup"}, OwnerReferences: []metav1.OwnerReference{{Kind: "Job", Name: "backup"}}},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "backup"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodSucceeded},
		},
	}

	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "apps"},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{"app": "db"},
			Ports:    []corev1.ServicePort{{Port: 5432, TargetPort: intstr.FromInt(5432)}},
		},
	}

	app.client = cgofake.NewClientset(deploy, rs, sts, ds, job, cronJob, service, &pods[0], &pods[1], &pods[2], &pods[3])

	if _, err := app.GetDeployment("apps", "web"); err != nil {
		t.Fatalf("expected deployment wrapper to succeed: %v", err)
	}
	if _, err := app.GetReplicaSet("apps", "web-rs"); err != nil {
		t.Fatalf("expected replicaset wrapper to succeed: %v", err)
	}
	if _, err := app.GetStatefulSet("apps", "db"); err != nil {
		t.Fatalf("expected statefulset wrapper to succeed: %v", err)
	}
	if _, err := app.GetDaemonSet("apps", "logger"); err != nil {
		t.Fatalf("expected daemonset wrapper to succeed: %v", err)
	}
	if _, err := app.GetJob("apps", "backup"); err != nil {
		t.Fatalf("expected job wrapper to succeed: %v", err)
	}
	if _, err := app.GetCronJob("apps", "nightly"); err != nil {
		t.Fatalf("expected cronjob wrapper to succeed: %v", err)
	}
}
