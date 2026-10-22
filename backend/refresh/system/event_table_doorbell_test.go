package system

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
)

// The Cluster Events and Namespace Events tables are fed by the owned events
// reflector: these tests run the production subsystem against an API server,
// so every write travels LIST/WATCH → store → table sink → doorbell.

func tableEvent(name, eventNamespace, objectKind, objectNamespace string) *corev1.Event {
	return &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: eventNamespace},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "v1", Kind: objectKind, Namespace: objectNamespace, Name: "obj-" + name,
		},
		Reason:        "Started",
		Type:          corev1.EventTypeNormal,
		LastTimestamp: metav1.NewTime(time.Now()),
	}
}

func requireEventDoorbell(t *testing.T, sub *resourcestream.Subscription, domainName, scope string) {
	t.Helper()
	select {
	case update := <-sub.Updates:
		require.Equal(t, domainName, update.Domain)
		require.Equal(t, scope, update.Scope)
		require.Equal(t, resourcestream.SourceEvent, update.Source)
		require.NotEmpty(t, update.Version)
	case <-time.After(3 * time.Second):
		t.Fatalf("expected a %s doorbell on scope %q", domainName, scope)
	}
}

// requireQuiet fails when any of the subscriptions receives a doorbell within
// the window, which must outlast the doorbell debounce.
func requireQuiet(t *testing.T, window time.Duration, subs map[string]*resourcestream.Subscription) {
	t.Helper()
	deadline := time.After(window)
	for {
		for label, sub := range subs {
			select {
			case update := <-sub.Updates:
				t.Fatalf("%s must stay quiet, got %s doorbell %q on %q", label, update.Domain, update.Version, update.Scope)
			default:
			}
		}
		select {
		case <-deadline:
			return
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// Every scope a table can be viewed at must hear a change after the table's
// own store has applied it: a namespaced event rings its namespace and All
// Namespaces, a cluster-scoped event rings the cluster table, a delete rings
// like an add, and the refetch each ring triggers sees the change.
func TestEventTableDoorbellsReachEveryViewedScopeAfterTheStoreApplies(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "")
	prod := h.subscribe(t, "namespace-events", "namespace:prod")
	all := h.subscribe(t, "namespace-events", "namespace:all")
	other := h.subscribe(t, "namespace-events", "namespace:other")
	cluster := h.subscribe(t, "cluster-events", "")

	// Prime the snapshot cache with the pre-change pages.
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:all"))
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:prod"))
	require.Empty(t, h.rowNames(t, "cluster-events", ""))

	podEvent := tableEvent("web.1", "prod", "Pod", "prod")
	server.Create(t, podEvent)

	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
	require.Equal(t, []string{"web.1"}, h.rowNames(t, "namespace-events", "namespace:all"))
	require.Equal(t, []string{"web.1"}, h.rowNames(t, "namespace-events", "namespace:prod"))
	requireQuiet(t, 750*time.Millisecond, map[string]*resourcestream.Subscription{
		"another namespace": other,
		"cluster events":    cluster,
	})

	server.Create(t, tableEvent("node-a.1", "default", "Node", ""))

	requireEventDoorbell(t, cluster, "cluster-events", "")
	require.Equal(t, []string{"node-a.1"}, h.rowNames(t, "cluster-events", ""))
	requireQuiet(t, 750*time.Millisecond, map[string]*resourcestream.Subscription{
		"namespace prod": prod,
		"all namespaces": all,
	})

	server.Delete(t, podEvent)

	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:all"))
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:prod"))
}

// A relist after a watch gap re-delivers every Event. Only the scopes whose
// rows changed may ring: Events are the highest-churn kind, and an unchanged
// relist must not refetch every open Events table.
func TestEventTableRelistRingsOnlyTheScopesItChanged(t *testing.T) {
	server := newReflectorAPIServer(t)
	podEvent := tableEvent("web.1", "prod", "Pod", "prod")
	server.Create(t, podEvent)
	server.Create(t, tableEvent("db.1", "data", "Pod", "data"))
	server.Create(t, tableEvent("node-a.1", "default", "Node", ""))
	h := newReflectorHarness(t, server, "")
	require.Equal(t, []string{"db.1", "web.1"}, h.rowNames(t, "namespace-events", "namespace:all"))
	prod := h.subscribe(t, "namespace-events", "namespace:prod")
	data := h.subscribe(t, "namespace-events", "namespace:data")
	cluster := h.subscribe(t, "cluster-events", "")
	// Drain the debounced rings of the initial list.
	collect(prod, 750*time.Millisecond)
	collect(data, 10*time.Millisecond)
	collect(cluster, 10*time.Millisecond)

	server.WatchGap(t, func() { server.Delete(t, podEvent) })

	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:prod"))
	requireQuiet(t, 1500*time.Millisecond, map[string]*resourcestream.Subscription{
		"unchanged namespace":     data,
		"unchanged cluster table": cluster,
	})
}

// A re-warm restores both tables from their spill and resumes the Events
// watch. Events that existed at the spill keep their rows with no Event
// changes; Events deleted while the cluster was Cold leave no rows behind,
// whether the watch resumes or the expired version forces a relist.
func TestEventTablesRewarmServeTheLiveEvents(t *testing.T) {
	newEvents := func() (*corev1.Event, *corev1.Event) {
		return tableEvent("web.1", "prod", "Pod", "prod"), tableEvent("node-a.1", "default", "Node", "")
	}
	start := func(t *testing.T) (*ingesttest.APIServer, string) {
		t.Helper()
		server := newReflectorAPIServer(t)
		podEvent, nodeEvent := newEvents()
		server.Create(t, podEvent)
		server.Create(t, nodeEvent)
		before := newReflectorHarness(t, server, "")
		require.Equal(t, []string{"web.1"}, before.rowNames(t, "namespace-events", "namespace:all"))
		require.Equal(t, []string{"node-a.1"}, before.rowNames(t, "cluster-events", ""))
		return server, before.spill(t)
	}

	t.Run("no changes while Cold", func(t *testing.T) {
		server, spill := start(t)
		after := newReflectorHarness(t, server, spill)
		require.Equal(t, []string{"web.1"}, after.rowNames(t, "namespace-events", "namespace:all"))
		require.Equal(t, []string{"node-a.1"}, after.rowNames(t, "cluster-events", ""))
	})
	t.Run("deleted while Cold, watch resumes", func(t *testing.T) {
		server, spill := start(t)
		podEvent, nodeEvent := newEvents()
		server.Delete(t, podEvent)
		server.Delete(t, nodeEvent)
		after := newReflectorHarness(t, server, spill)
		require.Eventually(t, func() bool {
			return len(after.rowNames(t, "namespace-events", "namespace:all")) == 0 && len(after.rowNames(t, "cluster-events", "")) == 0
		}, 5*time.Second, 20*time.Millisecond)
	})
	t.Run("deleted while Cold, version expired", func(t *testing.T) {
		server, spill := start(t)
		podEvent, nodeEvent := newEvents()
		server.WatchGap(t, func() {
			server.Delete(t, podEvent)
			server.Delete(t, nodeEvent)
		})
		after := newReflectorHarness(t, server, spill)
		require.Eventually(t, func() bool {
			return len(after.rowNames(t, "namespace-events", "namespace:all")) == 0 && len(after.rowNames(t, "cluster-events", "")) == 0
		}, 5*time.Second, 20*time.Millisecond)
	})
}

// The production constructor must give both event tables the subsystem's
// doorbell, and stopping it must end their subscriptions; otherwise the tables
// lose their doorbell. Silence after teardown is pinned by
// TestGenerationStopWaitsForRunningProducerCallbacks.
func TestSubsystemWiresAndStopsEventTableDoorbells(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "")
	all := h.subscribe(t, "namespace-events", "namespace:all")
	cluster := h.subscribe(t, "cluster-events", "")

	server.Create(t, tableEvent("web.1", "prod", "Pod", "prod"))
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
	server.Create(t, tableEvent("node-a.1", "default", "Node", ""))
	requireEventDoorbell(t, cluster, "cluster-events", "")

	h.subsystem.ResourceStream.Stop()
	select {
	case reason := <-all.Drops:
		require.Equal(t, resourcestream.DropReasonClosed, reason)
	case <-time.After(time.Second):
		t.Fatal("stopping the generation left the event table subscription open")
	}
}
