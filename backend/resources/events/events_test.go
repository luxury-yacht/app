/*
 * backend/resources/events/events_test.go
 *
 * Tests for Event resource handlers.
 * - Covers Event resource handlers behavior and edge cases.
 */

package events

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestServiceEventReturnsCompleteDetails(t *testing.T) {
	first := metav1.NewTime(time.Date(2026, 1, 3, 12, 0, 0, 0, time.UTC))
	last := metav1.NewTime(time.Date(2026, 1, 3, 12, 5, 0, 0, time.UTC))
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "orders.123",
			Namespace:   "apps",
			Labels:      map[string]string{"team": "checkout"},
			Annotations: map[string]string{"note": "repeated"},
		},
		Type:                corev1.EventTypeWarning,
		Reason:              "BackOff",
		Message:             "Back-off restarting failed container",
		Count:               4,
		FirstTimestamp:      first,
		LastTimestamp:       last,
		Action:              "Killing",
		ReportingController: "kubernetes.io/kubelet",
		ReportingInstance:   "kubelet-node-a",
		Source:              corev1.EventSource{Component: "kubelet", Host: "node-a"},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "v1",
			Kind:       "Pod",
			Namespace:  "apps",
			Name:       "orders-abc",
			UID:        types.UID("pod-uid"),
			FieldPath:  "spec.containers{api}",
		},
	}
	service := newEventsService(t, fake.NewClientset(event))

	details, err := service.Event("apps", "orders.123")

	require.NoError(t, err)
	require.Equal(t, "Event", details.Kind)
	require.Equal(t, "orders.123", details.Name)
	require.Equal(t, "apps", details.Namespace)
	require.Equal(t, "Warning", details.EventType)
	require.Equal(t, "Warning", details.Status)
	require.Equal(t, "warning", details.StatusPresentation)
	require.Equal(t, "BackOff", details.Reason)
	require.Equal(t, "Back-off restarting failed container", details.Message)
	require.Equal(t, int32(4), details.Count)
	require.Equal(t, first, details.FirstTimestamp)
	require.Equal(t, last, details.LastTimestamp)
	require.Equal(t, "kubelet on node-a", details.Source)
	require.Equal(t, "Killing", details.Action)
	require.NotNil(t, details.InvolvedObject)
	require.NotNil(t, details.InvolvedObject.Ref)
	require.Equal(t, "cluster-a", details.InvolvedObject.Ref.ClusterID)
	require.Equal(t, "pod-uid", details.InvolvedObject.Ref.UID)
	require.Equal(t, map[string]string{"team": "checkout"}, details.Labels)
	require.Equal(t, map[string]string{"note": "repeated"}, details.Annotations)
}

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

	client := fake.NewClientset(deploymentEvent.DeepCopy(), podEvent.DeepCopy())

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
	client := fake.NewClientset()
	service := newEventsService(t, client)

	_, err := service.NamespaceEvents("")
	require.Error(t, err)
}

func newEventsService(t testing.TB, client *fake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
	deps.ClusterID = "cluster-a"
	return NewService(deps)
}
