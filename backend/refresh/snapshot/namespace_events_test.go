package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestNamespaceEventsBuilderUsesEventTimestamps(t *testing.T) {
	now := time.Now()
	eventNew := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-new",
			Namespace:         "team-a",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
			ResourceVersion:   "22",
		},
		Type:    "Warning",
		Reason:  "BackOff",
		Message: "Retrying workload",
		Source:  corev1.EventSource{Component: "kubelet"},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "api-123",
			Namespace: "team-a",
		},
		LastTimestamp: metav1.NewTime(now.Add(-2 * time.Minute)),
	}

	eventOld := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-old",
			Namespace:         "team-a",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
			ResourceVersion:   "11",
		},
		Type:   "Normal",
		Reason: "Scheduled",
		Source: corev1.EventSource{Component: "scheduler"},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "api-122",
			Namespace: "team-a",
		},
		LastTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
	}

	builder := &NamespaceEventsBuilder{
		eventLister: testsupport.NewEventLister(t, eventNew, eventOld),
	}

	snapshot, err := builder.Build(context.Background(), "team-a")
	require.NoError(t, err)
	require.Equal(t, namespaceEventsDomainName, snapshot.Domain)
	require.Equal(t, "team-a", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceEventsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Events, 2)

	first := payload.Events[0]
	second := payload.Events[1]

	require.Equal(t, "event-new", first.Name)
	require.Equal(t, eventNew.LastTimestamp.UnixMilli(), first.AgeTimestamp)
	require.Equal(t, "Pod/api-123", first.Object)

	require.Equal(t, "event-old", second.Name)
	require.Equal(t, eventOld.LastTimestamp.UnixMilli(), second.AgeTimestamp)
	require.Equal(t, "team-a", second.Namespace)
}
