package informer

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestStripManagedFieldsRemovesOnlyManagedFields(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "p1",
			Namespace: "default",
			Labels:    map[string]string{"app": "x"},
			ManagedFields: []metav1.ManagedFieldsEntry{
				{Manager: "kubectl", Operation: "Apply"},
				{Manager: "kube-controller-manager", Operation: "Update"},
			},
		},
		Spec: corev1.PodSpec{NodeName: "node-1"},
	}
	out, err := StripManagedFields(pod)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := out.(*corev1.Pod)
	if !ok {
		t.Fatalf("transform changed the type: %T", out)
	}
	if got.ManagedFields != nil {
		t.Fatalf("managedFields not stripped: %v", got.ManagedFields)
	}
	if got.Name != "p1" || got.Namespace != "default" || got.Labels["app"] != "x" || got.Spec.NodeName != "node-1" {
		t.Fatalf("transform altered a non-managedFields field: %+v", got.ObjectMeta)
	}
}

func TestStripManagedFieldsNonAccessorIsNoOp(t *testing.T) {
	in := "not-a-k8s-object"
	out, err := StripManagedFields(in)
	if err != nil {
		t.Fatalf("non-accessor input must not error: %v", err)
	}
	if s, ok := out.(string); !ok || s != in {
		t.Fatalf("non-accessor input must be returned unchanged, got %v", out)
	}
}
