package backend

import (
	"testing"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func newAutoscalingResourceGateway(client *cgofake.Clientset) *ResourceGateway {
	fixture := newResourceGatewayFixture()
	fixture.setCluster("cluster-a", &clusterClients{
		meta: ClusterMeta{ID: "cluster-a", Name: "cluster-a"}, client: client,
	})
	return fixture.gateway
}

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
	gateway := newAutoscalingResourceGateway(client)

	managed, err := gateway.IsWorkloadHPAManaged("cluster-a", "default", "apps", "v1", "Deployment", "web")
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
	gateway := newAutoscalingResourceGateway(client)

	managed, err := gateway.IsWorkloadHPAManaged("cluster-a", "default", "apps", "v1", "Deployment", "web")
	if err != nil {
		t.Fatalf("IsWorkloadHPAManaged returned error: %v", err)
	}
	if managed {
		t.Fatalf("apps/v1 Deployment should not match example.com/v1 Deployment")
	}
}

func TestIsWorkloadHPAManagedRejectsUnsupportedGVK(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway

	_, err := gateway.IsWorkloadHPAManaged("cluster-a", "default", "example.com", "v1", "Deployment", "web")
	if err == nil {
		t.Fatalf("expected unsupported GVK error")
	}
}

func TestIsWorkloadHPAManagedRequiresNamespacedObjectIdentity(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway

	_, err := gateway.IsWorkloadHPAManaged("cluster-a", "", "apps", "v1", "Deployment", "web")
	if err == nil || err.Error() != "namespace is required" {
		t.Fatalf("expected namespace error, got %v", err)
	}

	_, err = gateway.IsWorkloadHPAManaged("cluster-a", "default", "apps", "v1", "Deployment", "")
	if err == nil || err.Error() != "name is required" {
		t.Fatalf("expected name error, got %v", err)
	}
}
