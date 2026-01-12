package events

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kubefake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestServiceEventsFiltersByObject(t *testing.T) {
	now := metav1.NewTime(time.Now())
	deploymentEvent := &corev1.Event{
		ObjectMeta:    metav1.ObjectMeta{Name: "event-new", Namespace: "default"},
		Reason:        "ScalingReplicaSet",
		Message:       "Scaled up deployment",
		Type:          corev1.EventTypeNormal,
		Count:         1,
		LastTimestamp: now,
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Deployment",
			Namespace: "default",
			Name:      "web",
		},
		Source: corev1.EventSource{Component: "deployment-controller"},
	}

	podEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: "event-other", Namespace: "default"},
		Reason:     "Scheduled",
		Type:       corev1.EventTypeNormal,
		Count:      1,
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "db-0",
		},
		Source: corev1.EventSource{Component: "scheduler"},
	}

	client := kubefake.NewClientset(deploymentEvent.DeepCopy(), podEvent.DeepCopy())

	service := newEventsService(t, client)

	filtered, err := service.ObjectEvents("Deployment", "default", "web")
	require.NoError(t, err)
	require.Len(t, filtered, 1)
	require.Equal(t, "Scaled up deployment", filtered[0].Message)

	all, err := service.AllEvents()
	require.NoError(t, err)
	require.Len(t, all, 2)
}

func TestNamespaceEventsRequiresNamespace(t *testing.T) {
	client := kubefake.NewClientset()
	service := newEventsService(t, client)

	_, err := service.NamespaceEvents("")
	require.Error(t, err)
}

func newEventsService(t testing.TB, client *kubefake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(testsupport.NoopLogger{}),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	return NewService(Dependencies{Common: deps})
}
