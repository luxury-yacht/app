package backend

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func TestRestartWorkloadRequiresPatchPermission(t *testing.T) {
	client := cgofake.NewClientset(&appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "demo"}},
			},
		},
	})
	denySelfSubjectAccessReviews(client, "no patch deployments")

	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
	})

	err := app.RestartWorkload("cluster-a", "default", "apps", "v1", "Deployment", "demo")
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected permission denial, got %v", err)
	}
	for _, action := range client.Actions() {
		if action.Matches("patch", "deployments") {
			t.Fatalf("deployment patch should not run after permission denial: %#v", action)
		}
	}
}

func TestDeleteResourceByGVKRequiresDeletePermission(t *testing.T) {
	client := cgofake.NewClientset()
	denySelfSubjectAccessReviews(client, "no delete pods")
	dynamicClient := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())

	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
		dynamicClient:     dynamicClient,
	})

	err := app.DeleteResourceByGVK("cluster-a", "v1", "Pod", "default", "demo")
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected permission denial, got %v", err)
	}
	if actions := dynamicClient.Actions(); len(actions) != 0 {
		t.Fatalf("dynamic client should not be called after permission denial: %#v", actions)
	}
}
