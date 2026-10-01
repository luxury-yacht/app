package snapshot

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// untypedEvent is an Event whose type, source, and message are all empty. Every
// event surface must send those as the empty values they are, so the frontend
// renders one placeholder for them everywhere.
func untypedEvent(name, objectKind, objectNamespace, objectName string) *corev1.Event {
	return &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default", ResourceVersion: "7"},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "v1", Kind: objectKind, Namespace: objectNamespace, Name: objectName,
		},
		Reason:        "Started",
		LastTimestamp: metav1.NewTime(time.Now()),
	}
}

func TestEventSurfacesSendEmptyDisplayFieldsRaw(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1"}

	clusterRow, ok := projectClusterEventEntry(meta, untypedEvent("node.1", "Node", "", "node-a"))
	require.True(t, ok)
	require.Equal(t, "", clusterRow.Type, "cluster events type")
	require.Equal(t, "", clusterRow.Source, "cluster events source")
	require.Equal(t, "", clusterRow.Message, "cluster events message must not repeat the reason")

	namespaceRow, ok := projectNamespaceEventSummary(meta, untypedEvent("web.1", "Pod", "prod", "web"))
	require.True(t, ok)
	require.Equal(t, "", namespaceRow.Type, "namespace events type")
	require.Equal(t, "", namespaceRow.Source, "namespace events source")
	require.Equal(t, "", namespaceRow.Message, "namespace events message")

	objectRow := convertObjectEvent(meta, *untypedEvent("web.1", "Pod", "prod", "web"))
	require.Equal(t, "", objectRow.EventType, "object events type")
	require.Equal(t, "", objectRow.Source, "object events source")
	require.Equal(t, "", objectRow.Message, "object events message")

	warning := untypedEvent("web.2", "Pod", "prod", "web")
	warning.Type = corev1.EventTypeWarning
	recent := buildRecentEvents([]*corev1.Event{warning}, meta)
	require.Len(t, recent, 1)
	require.Equal(t, "", recent[0].Message, "overview message must not repeat the reason")
}

// Object Type and Object Name come from the involved object itself, not from
// parsing the "Kind/Name" display text.
func TestEventTableRowsCarryTheInvolvedObjectKindAndName(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1"}

	clusterRow, ok := projectClusterEventEntry(meta, untypedEvent("node.1", "Node", "", "node-a"))
	require.True(t, ok)
	require.Equal(t, "Node", clusterRow.ObjectKind)
	require.Equal(t, "node-a", clusterRow.ObjectName)

	namespaceRow, ok := projectNamespaceEventSummary(meta, untypedEvent("web.1", "Pod", "prod", "web"))
	require.True(t, ok)
	require.Equal(t, "Pod", namespaceRow.ObjectKind)
	require.Equal(t, "web", namespaceRow.ObjectName)
}

// An Event that names no involved object sends an empty Object field, like
// every other empty display field, rather than its own placeholder text.
func TestEventTableRowsSendAnEmptyObjectWhenTheEventNamesNone(t *testing.T) {
	row, ok := projectClusterEventEntry(ClusterMeta{ClusterID: "c1"}, untypedEvent("orphan.1", "", "", ""))
	require.True(t, ok)
	require.Equal(t, "", row.Object)
	require.Equal(t, "", row.ObjectKind)
	require.Equal(t, "", row.ObjectName)
}
