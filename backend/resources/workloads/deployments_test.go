package workloads_test

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/workloads"
	"github.com/luxury-yacht/app/backend/testsupport"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	kubefake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/utils/ptr"
)

func TestDeploymentServiceDeployment(t *testing.T) {
	deployment := testsupport.DeploymentFixture("default", "web", testsupport.DeploymentWithReplicas(2))
	deployment.UID = types.UID("deployment-web")
	deployment.Status.Replicas = 2
	deployment.Status.ReadyReplicas = 2
	deployment.Status.AvailableReplicas = 2

	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs",
			Namespace: "default",
			Labels:    map[string]string{"app": "web"},
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       deployment.Name,
				UID:        deployment.UID,
				Controller: ptr.To(true),
			}},
		},
		Spec: appsv1.ReplicaSetSpec{
			Selector: deployment.Spec.Selector,
			Template: deployment.Spec.Template,
		},
	}
	replicaSet.UID = types.UID("replicaset-web")

	podA := testsupport.PodFixture(
		"default",
		"web-0",
		testsupport.PodWithOwner("ReplicaSet", replicaSet.Name, true),
		testsupport.PodWithLabels(map[string]string{"app": "web"}),
	)
	podB := testsupport.PodFixture(
		"default",
		"web-1",
		testsupport.PodWithOwner("ReplicaSet", replicaSet.Name, true),
		testsupport.PodWithLabels(map[string]string{"app": "web"}),
	)

	if len(podA.OwnerReferences) > 0 {
		podA.OwnerReferences[0].UID = replicaSet.UID
	}
	if len(podB.OwnerReferences) > 0 {
		podB.OwnerReferences[0].UID = replicaSet.UID
	}

	client := kubefake.NewClientset(
		deployment.DeepCopy(),
		replicaSet.DeepCopy(),
		podA.DeepCopy(),
		podB.DeepCopy(),
	)

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	)

	service := workloads.NewDeploymentService(workloads.Dependencies{Common: deps})
	details, err := service.Deployment("default", "web")
	if err != nil {
		t.Fatalf("Deployment returned error: %v", err)
	}
	if details == nil {
		t.Fatalf("Deployment returned nil details")
	}
	if details.Name != "web" {
		t.Fatalf("expected deployment name 'web', got %s", details.Name)
	}
	if len(details.Pods) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(details.Pods))
	}

	ownerKinds := map[string]string{}
	for _, pod := range details.Pods {
		ownerKinds[pod.Name] = pod.OwnerKind
	}
	if ownerKinds["web-0"] != "Deployment" || ownerKinds["web-1"] != "Deployment" {
		t.Fatalf("expected pods to resolve to Deployment owner, got %+v", ownerKinds)
	}
}
