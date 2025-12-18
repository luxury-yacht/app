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

func TestClusterEventsBuilder(t *testing.T) {
	now := time.Now()
	eventNew := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-new",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
			ResourceVersion:   "20",
		},
		Type:    "Normal",
		Reason:  "Scheduled",
		Message: "Pod scheduled",
		Source: corev1.EventSource{
			Component: "scheduler",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "pod-new",
			Namespace: "default",
		},
		LastTimestamp: metav1.NewTime(now.Add(-2 * time.Minute)),
	}

	eventOld := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-old",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
			ResourceVersion:   "10",
		},
		Type:   "Warning",
		Reason: "BackOff",
		Source: corev1.EventSource{Component: "kubelet", Host: "node-a"},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "pod-old",
			Namespace: "default",
		},
		Message:       "",
		LastTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
	}

	builder := &ClusterEventsBuilder{
		eventLister: testsupport.NewEventLister(t, eventNew, eventOld),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterEventsDomainName, snapshot.Domain)
	require.Equal(t, uint64(20), snapshot.Version)

	payload, ok := snapshot.Payload.(ClusterEventsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Events, 2)

	// Events should be sorted newest first
	first := payload.Events[0]
	second := payload.Events[1]
	require.Equal(t, "event-new", first.Name)
	require.Equal(t, "Normal", first.Type)
	require.Equal(t, "scheduler", first.Source)

	require.Equal(t, "event-old", second.Name)
	require.Equal(t, "Warning", second.Type)
	require.Contains(t, second.Source, "kubelet")
	require.Equal(t, "Pod/pod-old", second.Object)
	require.Equal(t, "BackOff", second.Message) // falls back to reason when message empty
}
