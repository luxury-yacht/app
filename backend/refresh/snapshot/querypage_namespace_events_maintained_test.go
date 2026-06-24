package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"
)

// nsEventObj builds an event about a namespaced object. The Kubernetes event recorder
// creates the event in the involved object's namespace, so metadata.namespace ==
// involvedObject.namespace — the invariant the maintained store relies on.
func nsEventObj(name, ns, kind, reason string, rv string, secs int64) *corev1.Event {
	return &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, ResourceVersion: rv},
		InvolvedObject: corev1.ObjectReference{
			Kind: kind, Namespace: ns, Name: "obj-" + name, APIVersion: "v1",
		},
		Reason:        reason,
		Message:       "msg-" + reason,
		Type:          "Normal",
		Source:        corev1.EventSource{Component: "kubelet"},
		LastTimestamp: metav1.NewTime(time.Unix(1_700_000_000+secs, 0)),
	}
}

// TestNamespaceEventsBuilderMaintainedMatchesListPath is the namespace-events maintained-store
// cutover gate: a builder serving from the informer-fed store must produce the byte-identical
// NamespaceEventsSnapshot the list path produces across all-namespaces + per-namespace +
// query scopes. The open involved-object kind set is served via rowsInNamespace (namespace
// filter only).
func TestNamespaceEventsBuilderMaintainedMatchesListPath(t *testing.T) {
	meta := ClusterMeta{}
	events := []*corev1.Event{
		nsEventObj("a.1", "default", "Pod", "Started", "3", 5),
		nsEventObj("b.2", "default", "Deployment", "ScalingReplicaSet", "5", 2),
		nsEventObj("c.3", "kube-system", "Pod", "Pulled", "4", 9),
		// cluster-scoped event (no involved namespace) — dropped on both paths.
		clusterEventObj("node.4", "6", "NodeReady", "ready", 1),
	}

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	maintained := newTypedMaintainedStore(meta, namespaceEventsQuerypageSchema(), namespacedEventTableQueryAdapter())
	for _, e := range events {
		require.NoError(t, indexer.Add(e))
		if summary, ok := projectNamespaceEventSummary(meta, e); ok {
			maintained.upsertRow(summary, e)
		}
	}
	listBuilder := &NamespaceEventsBuilder{eventLister: corelisters.NewEventLister(indexer)}
	maintainedBuilder := &NamespaceEventsBuilder{maintained: maintained}

	scopes := []string{
		"namespace:all",
		"namespace:default",
		"namespace:kube-system",
		"namespace:all?limit=2&sortField=name&sortDirection=asc",
		"namespace:all?search=Pod",
		"namespace:default?sortField=reason&sortDirection=desc",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceEventsSnapshot),
			maintSnap.Payload.(NamespaceEventsSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
		// Version is intentionally NOT asserted: the maintained store reports a global
		// monotonic version (max RV across all namespaces), whereas the list path reports
		// the per-scope max RV. This is the same accepted behavior as the other
		// namespace-scoped maintained domains (their gates compare payload only) — a
		// slightly broader refetch trigger, never wrong rows.
	}
}
