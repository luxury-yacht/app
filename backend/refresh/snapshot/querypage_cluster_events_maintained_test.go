package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// clusterEventObj builds a namespaced Event involving a cluster-scoped object (empty
// involved-object namespace, so it is kept by the cluster-events filter). secs offsets the
// timestamp so the age ordering varies.
func clusterEventObj(name, rv, reason, msg string, secs int64) *corev1.Event {
	return &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "kube-system", ResourceVersion: rv},
		InvolvedObject: corev1.ObjectReference{
			Kind: "Node", Name: "node-1", APIVersion: "v1",
		},
		Reason:        reason,
		Message:       msg,
		Type:          "Warning",
		Source:        corev1.EventSource{Component: "kubelet"},
		LastTimestamp: metav1.NewTime(time.Unix(1_700_000_000+secs, 0)),
	}
}

// namespacedEventObj builds an event about a NAMESPACED object — the cluster-events filter
// must drop it on BOTH paths, so including it proves the filter parity.
func namespacedEventObj(name, rv string) *corev1.Event {
	return &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: name, Namespace: "default", ResourceVersion: rv},
		InvolvedObject: corev1.ObjectReference{Kind: "Pod", Namespace: "default", Name: "p1", APIVersion: "v1"},
		Reason:         "Started",
		LastTimestamp:  metav1.NewTime(time.Unix(1_700_000_100, 0)),
	}
}

// TestClusterEventsBuilderMaintainedMatchesListPath is the cluster-events sink gate: a
// builder serving from the store its events sink fills must produce the byte-identical
// ClusterEventsSnapshot a store of directly projected rows produces, across window +
// query scopes. Both skip namespaced events via the shared clusterEventEntry.
func TestClusterEventsBuilderMaintainedMatchesListPath(t *testing.T) {
	meta := ClusterMeta{}
	events := []*corev1.Event{
		clusterEventObj("node-pressure.1", "3", "NodeHasDiskPressure", "disk", 5),
		clusterEventObj("node-ready.2", "5", "NodeReady", "ready", 2),
		clusterEventObj("node-pressure.3", "4", "NodeHasMemoryPressure", "mem", 9),
		namespacedEventObj("pod-started.4", "6"), // dropped on both paths
	}

	listBuilder := clusterEventsProjectedBuilder(meta, events...)
	maintainedBuilder := clusterEventsBuilderFor(t, meta, events...)

	scopes := []string{
		"",
		"cluster-a|?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|?limit=50&sortField=reason&sortDirection=desc",
		"cluster-a|?search=pressure",
		"cluster-a|?sortField=age&sortDirection=asc",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(ClusterEventsSnapshot),
			maintSnap.Payload.(ClusterEventsSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
		// Version is not compared: the sink-fed store's version counts its
		// changes, while the projected reference reports the max resourceVersion.
	}
}
