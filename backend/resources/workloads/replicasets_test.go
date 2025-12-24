package workloads_test

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/workloads"
	"github.com/luxury-yacht/app/backend/testsupport"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	kubefake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/utils/ptr"
)

func TestReplicaSetServiceReplicaSet(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
		},
	}

	replicas := int32(2)
	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs",
			Namespace: "default",
			Labels:    map[string]string{"app": "web"},
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       deployment.Name,
				Controller: ptr.To(true),
			}},
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "web"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: "nginx"}}},
			},
		},
		Status: appsv1.ReplicaSetStatus{
			Replicas:          2,
			ReadyReplicas:     1,
			AvailableReplicas: 1,
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
		podA.OwnerReferences[0].Controller = ptr.To(true)
	}
	if len(podB.OwnerReferences) > 0 {
		podB.OwnerReferences[0].UID = replicaSet.UID
		podB.OwnerReferences[0].Controller = ptr.To(true)
	}

	client := kubefake.NewClientset(deployment.DeepCopy(), replicaSet.DeepCopy(), podA.DeepCopy(), podB.DeepCopy())
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	)

	service := workloads.NewReplicaSetService(workloads.Dependencies{Common: deps})
	details, err := service.ReplicaSet("default", "web-rs")
	if err != nil {
		t.Fatalf("ReplicaSet returned error: %v", err)
	}
	if details == nil {
		t.Fatalf("ReplicaSet returned nil details")
	}
	if details.Name != "web-rs" {
		t.Fatalf("expected ReplicaSet name 'web-rs', got %s", details.Name)
	}
	if details.Replicas != "2/2" {
		t.Fatalf("expected replicas '2/2', got %s", details.Replicas)
	}
	if details.Ready != "1/2" {
		t.Fatalf("expected ready '1/2', got %s", details.Ready)
	}
	if !details.IsActive {
		t.Fatalf("expected ReplicaSet to be active")
	}
	if len(details.Pods) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(details.Pods))
	}
	if len(details.Containers) != 1 {
		t.Fatalf("expected 1 container, got %d", len(details.Containers))
	}
}

func TestReplicaSetServiceReplicaSetInactiveRevision(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
		},
	}

	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       deployment.Name,
				Controller: ptr.To(true),
			}},
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "web"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: "nginx"}}},
			},
		},
		Status: appsv1.ReplicaSetStatus{Replicas: 1, ReadyReplicas: 1},
	}

	client := kubefake.NewClientset(deployment.DeepCopy(), replicaSet.DeepCopy())
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
	)

	service := workloads.NewReplicaSetService(workloads.Dependencies{Common: deps})
	details, err := service.ReplicaSet("default", "web-rs")
	if err != nil {
		t.Fatalf("ReplicaSet returned error: %v", err)
	}
	if details == nil {
		t.Fatalf("ReplicaSet returned nil details")
	}
	if details.IsActive {
		t.Fatalf("expected ReplicaSet to be inactive")
	}
}
