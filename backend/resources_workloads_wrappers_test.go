package backend

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"

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
	app.client = kubernetesfake.NewSimpleClientset(deploy)

	resp, err := app.GetWorkloads("default", "")
	if err != nil {
		t.Fatalf("expected workloads to succeed: %v", err)
	}
	if resp == nil || resp.Data == nil {
		t.Fatalf("expected workload data, got %+v", resp)
	}
}
