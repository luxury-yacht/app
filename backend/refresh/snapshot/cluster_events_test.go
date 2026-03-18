package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/testsupport"
	types "k8s.io/apimachinery/pkg/types"
)

func TestClusterEventsBuilder(t *testing.T) {
	now := time.Now()
	clusterEventNew := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-new",
			Namespace:         "kube-system",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
			ResourceVersion:   "20",
		},
		Type:    "Normal",
		Reason:  "RegisteredNode",
		Message: "Node registered",
		Source: corev1.EventSource{
			Component: "scheduler",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind: "Node",
			Name: "node-new",
		},
		LastTimestamp: metav1.NewTime(now.Add(-2 * time.Minute)),
	}

	clusterEventOld := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-old",
			Namespace:         "kube-system",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
			ResourceVersion:   "10",
		},
		Type:   "Warning",
		Reason: "FailedMount",
		Source: corev1.EventSource{Component: "kubelet", Host: "node-a"},
		InvolvedObject: corev1.ObjectReference{
			Kind: "PersistentVolume",
			Name: "pv-old",
		},
		Message:       "",
		LastTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
	}

	namespacedEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-namespaced",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute)),
			ResourceVersion:   "30",
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
		LastTimestamp: metav1.NewTime(now.Add(-1 * time.Minute)),
	}

	builder := &ClusterEventsBuilder{
		eventLister: testsupport.NewEventLister(t, clusterEventNew, clusterEventOld, namespacedEvent),
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
	require.Equal(t, clusterEventNew.LastTimestamp.UnixMilli(), first.AgeTimestamp)
	require.Equal(t, "", first.Namespace)

	require.Equal(t, "event-old", second.Name)
	require.Equal(t, "Warning", second.Type)
	require.Contains(t, second.Source, "kubelet")
	require.Equal(t, "PersistentVolume/pv-old", second.Object)
	require.Equal(t, "FailedMount", second.Message) // falls back to reason when message empty
	require.Equal(t, clusterEventOld.LastTimestamp.UnixMilli(), second.AgeTimestamp)
	require.Equal(t, "", second.Namespace)
}

func TestClusterEventsBuilderUsesDeterministicTieBreakers(t *testing.T) {
	timestamp := metav1.NewTime(time.Now().Add(-12 * time.Minute))

	highRV := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-high-rv",
			Namespace:         "kube-system",
			ResourceVersion:   "20",
			UID:               types.UID("uid-b"),
			CreationTimestamp: timestamp,
		},
		InvolvedObject: corev1.ObjectReference{
			Kind: "Node",
			Name: "node-a",
		},
		LastTimestamp: timestamp,
	}

	lowRV := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-low-rv",
			Namespace:         "kube-system",
			ResourceVersion:   "10",
			UID:               types.UID("uid-a"),
			CreationTimestamp: timestamp,
		},
		InvolvedObject: corev1.ObjectReference{
			Kind: "Node",
			Name: "node-b",
		},
		LastTimestamp: timestamp,
	}

	builder := &ClusterEventsBuilder{
		eventLister: testsupport.NewEventLister(t, lowRV, highRV),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterEventsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Events, 2)
	require.Equal(t, "event-high-rv", payload.Events[0].Name)
	require.Equal(t, "event-low-rv", payload.Events[1].Name)
}
