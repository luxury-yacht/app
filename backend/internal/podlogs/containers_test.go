package podlogs

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestEnumerateContainersIncludesInitRegularAndEphemeral(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-abc"}},
			},
		},
	}

	containers := EnumerateContainers(pod, "")
	if len(containers) != 3 {
		t.Fatalf("expected 3 containers, got %d", len(containers))
	}
	if got := []string{containers[0].DisplayName(), containers[1].DisplayName(), containers[2].DisplayName()}; got[0] != "init (init)" || got[1] != "app" || got[2] != "debug-abc (debug)" {
		t.Fatalf("unexpected display order: %#v", got)
	}
}

func TestMatchContainerFilterSupportsDisplayLabels(t *testing.T) {
	if !MatchContainerFilter(ContainerRef{Name: "init", IsInit: true}, "init (init)") {
		t.Fatal("expected init display label to match")
	}
	if !MatchContainerFilter(ContainerRef{Name: "debug-abc", IsEphemeral: true}, "debug-abc (debug)") {
		t.Fatal("expected debug display label to match")
	}
	if MatchContainerFilter(ContainerRef{Name: "app"}, "worker") {
		t.Fatal("did not expect unrelated filter to match")
	}
}
