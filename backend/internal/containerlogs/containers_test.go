package containerlogs

import (
	"reflect"
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

	want := []ContainerRef{{Name: "init", IsInit: true}, {Name: "app"}, {Name: "debug-abc", IsEphemeral: true}}
	if got := EnumerateContainers(pod, ScopeSelection{}); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected containers: %#v", got)
	}
}

// Selection values carry the container class, so selecting an init container
// must not also select a regular or debug container with the same name.
func TestEnumerateContainersAppliesClassAwareSelection(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "setup"}},
			Containers:     []corev1.Container{{Name: "setup"}, {Name: "app"}},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "setup"}},
			},
		},
	}

	initOnly := EnumerateContainers(pod, ParseScopeSelection([]string{SelectedInitPrefix + "setup"}))
	if len(initOnly) != 1 || !initOnly[0].IsInit || initOnly[0].Name != "setup" {
		t.Fatalf("expected only the init container, got %#v", initOnly)
	}

	regularAndDebug := EnumerateContainers(pod, ParseScopeSelection([]string{
		SelectedContainerPrefix + "setup",
		SelectedDebugPrefix + "setup",
	}))
	if len(regularAndDebug) != 2 || regularAndDebug[0].IsInit || regularAndDebug[0].IsEphemeral || !regularAndDebug[1].IsEphemeral {
		t.Fatalf("expected the regular and debug containers only, got %#v", regularAndDebug)
	}
}
