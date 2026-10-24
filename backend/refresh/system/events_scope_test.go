package system

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// An identity scoped to team-a, with no cluster-wide Event access, sees the
// Events about team-a objects and their warning count: the events store
// partitions per configured namespace like every owned namespaced kind.
func TestScopedIdentitySeesEventsInItsNamespaces(t *testing.T) {
	h := newIngestHarnessReviewing(t, func(attrs authorizationv1.ResourceAttributes) bool {
		if attrs.Group == "" && attrs.Resource == "events" {
			return attrs.Namespace == "team-a"
		}
		return true
	}, "team-a")
	warning := tableEvent("web.1", "team-a", "Pod", "team-a")
	warning.ResourceVersion = "1"
	warning.Type = corev1.EventTypeWarning
	require.NoError(t, h.store(t, eventGVR).PartitionView("team-a").Replace([]interface{}{warning}, "1"))

	require.Equal(t, []string{"web.1"}, h.rowNames(t, "namespace-events", "namespace:team-a"))

	snap, err := h.subsystem.SnapshotService.Build(context.Background(), "namespaces", "c1|")
	require.NoError(t, err)
	rows := snap.Payload.(snapshot.NamespaceSnapshot).Namespaces
	require.Len(t, rows, 1)
	require.Equal(t, "team-a", rows[0].Ref.Name)
	require.Equal(t, 1, rows[0].WarningEvents)
	require.Equal(t, snapshot.NamespaceSignalAvailable, rows[0].WarningEventsState)
}

// With Event access in only one scoped namespace, the other namespace has no
// watched Events, so its warning count must not read as an authoritative zero.
func TestScopedWarningEventStateFollowsEachNamespacesAccess(t *testing.T) {
	server := ingesttest.NewAPIServer(t, reflectedBuiltinKinds...)
	server.Allow(func(attrs authorizationv1.ResourceAttributes) bool {
		if attrs.Group == "" && attrs.Resource == "events" {
			return attrs.Namespace == "team-a"
		}
		return attrs.Group != "metrics.k8s.io"
	})
	for _, name := range []string{"team-a", "team-b"} {
		server.Create(t, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name}})
	}
	warning := tableEvent("web.1", "team-a", "Pod", "team-a")
	warning.Type = corev1.EventTypeWarning
	server.Create(t, warning)
	h := newReflectorHarness(t, server, "", func(cfg *Config) { cfg.AllowedNamespaces = []string{"team-a", "team-b"} })

	snap, err := h.subsystem.SnapshotService.Build(context.Background(), "namespaces", "c1|")
	require.NoError(t, err)
	states := make(map[string]snapshot.NamespaceSignalState)
	counts := make(map[string]int)
	for _, row := range snap.Payload.(snapshot.NamespaceSnapshot).Namespaces {
		states[row.Ref.Name] = row.WarningEventsState
		counts[row.Ref.Name] = row.WarningEvents
	}
	require.Equal(t, map[string]snapshot.NamespaceSignalState{
		"team-a": snapshot.NamespaceSignalAvailable,
		"team-b": snapshot.NamespaceSignalUnavailable,
	}, states)
	require.Equal(t, 1, counts["team-a"])
}
