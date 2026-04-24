package containerlogs

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestSelectTargetsPrefersReadyRunningPods(t *testing.T) {
	readyRunning := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-2", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{{
				Type:   corev1.PodReady,
				Status: corev1.ConditionTrue,
			}},
		},
	}
	runningNotReady := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-1", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	pending := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodPending},
	}

	targets, total := SelectTargets(
		[]*corev1.Pod{pending, runningNotReady, readyRunning},
		DefaultContainerSelection(""),
		10,
	)
	if total != 3 {
		t.Fatalf("expected 3 total targets, got %d", total)
	}
	if len(targets) != 3 {
		t.Fatalf("expected 3 selected targets, got %d", len(targets))
	}
	if targets[0].PodName != "api-2" || targets[1].PodName != "api-1" || targets[2].PodName != "api-0" {
		t.Fatalf("unexpected target order: %#v", targets)
	}
}

func TestSelectTargetsAppliesLimitAfterDeterministicSort(t *testing.T) {
	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-a", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "sidecar"}, {Name: "app"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{{
				Type:   corev1.PodReady,
				Status: corev1.ConditionTrue,
			}},
		},
	}
	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-b", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{{
				Type:   corev1.PodReady,
				Status: corev1.ConditionTrue,
			}},
		},
	}

	targets, total := SelectTargets([]*corev1.Pod{podB, podA}, DefaultContainerSelection(""), 2)
	if total != 3 {
		t.Fatalf("expected 3 total targets, got %d", total)
	}
	if len(targets) != 2 {
		t.Fatalf("expected 2 selected targets, got %d", len(targets))
	}
	if targets[0].PodName != "api-a" || targets[0].Container.Name != "app" {
		t.Fatalf("unexpected first target: %#v", targets[0])
	}
	if targets[1].PodName != "api-a" || targets[1].Container.Name != "sidecar" {
		t.Fatalf("unexpected second target: %#v", targets[1])
	}
}
