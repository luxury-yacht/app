package backend

import (
	"context"
	"testing"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func TestIsWorkloadHPAManagedMatchesFullGVK(t *testing.T) {
	client := cgofake.NewClientset(&autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
		},
	})
	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
	})

	managed, err := app.IsWorkloadHPAManaged("cluster-a", "default", "apps", "v1", "Deployment", "web")
	if err != nil {
		t.Fatalf("IsWorkloadHPAManaged returned error: %v", err)
	}
	if !managed {
		t.Fatalf("expected deployment to be HPA managed")
	}
}

func TestIsWorkloadHPAManagedDoesNotMatchKindOnlyCollision(t *testing.T) {
	client := cgofake.NewClientset(&autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "custom", Namespace: "default"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "example.com/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
		},
	})
	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
	})

	managed, err := app.IsWorkloadHPAManaged("cluster-a", "default", "apps", "v1", "Deployment", "web")
	if err != nil {
		t.Fatalf("IsWorkloadHPAManaged returned error: %v", err)
	}
	if managed {
		t.Fatalf("apps/v1 Deployment should not match example.com/v1 Deployment")
	}
}

func TestIsWorkloadHPAManagedRejectsUnsupportedGVK(t *testing.T) {
	app := NewApp()

	_, err := app.IsWorkloadHPAManaged("cluster-a", "default", "example.com", "v1", "Deployment", "web")
	if err == nil {
		t.Fatalf("expected unsupported GVK error")
	}
}
