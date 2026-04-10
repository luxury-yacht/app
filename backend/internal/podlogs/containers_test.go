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

func TestEnumerateContainersWithOptionsSupportsClassAndStateFilters(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init"}},
			Containers:     []corev1.Container{{Name: "app"}, {Name: "sidecar"}},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-abc"}},
			},
		},
		Status: corev1.PodStatus{
			InitContainerStatuses:      []corev1.ContainerStatus{{Name: "init", State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{}}}},
			ContainerStatuses:          []corev1.ContainerStatus{{Name: "app", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}, {Name: "sidecar", State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}}},
			EphemeralContainerStatuses: []corev1.ContainerStatus{{Name: "debug-abc", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}},
		},
	}

	noEphemeral := EnumerateContainersWithOptions(pod, ContainerSelectionOptions{
		IncludeInit:      true,
		IncludeEphemeral: false,
		StateFilter:      ContainerStateAll,
	})
	if got := []string{noEphemeral[0].Name, noEphemeral[1].Name, noEphemeral[2].Name}; len(noEphemeral) != 3 || got[0] != "init" || got[1] != "app" || got[2] != "sidecar" {
		t.Fatalf("expected init + regular containers without ephemeral, got %#v", got)
	}

	runningOnly := EnumerateContainersWithOptions(pod, ContainerSelectionOptions{
		IncludeInit:      true,
		IncludeEphemeral: true,
		StateFilter:      ContainerStateRunning,
	})
	if got := []string{runningOnly[0].Name, runningOnly[1].Name}; len(runningOnly) != 2 || got[0] != "app" || got[1] != "debug-abc" {
		t.Fatalf("expected running app + debug containers, got %#v", got)
	}

	explicitInit := EnumerateContainersWithOptions(pod, ContainerSelectionOptions{
		Filter:           "init (init)",
		IncludeInit:      false,
		IncludeEphemeral: false,
		StateFilter:      ContainerStateRunning,
	})
	if len(explicitInit) != 1 || explicitInit[0].Name != "init" || !explicitInit[0].IsInit {
		t.Fatalf("expected explicit init filter to bypass class/state exclusions, got %#v", explicitInit)
	}
}
