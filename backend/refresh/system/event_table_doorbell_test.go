package system

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// eventTableHarness composes the real owners behind the Cluster Events and
// Namespace Events tables: a shared Events informer feeding the maintained
// stores, the doorbell wiring production uses, the resource-stream manager the
// frontend subscribes to, and a snapshot service the signal-triggered refetch
// reads from.
type eventTableHarness struct {
	client  *fake.Clientset
	service *snapshot.Service
	manager *resourcestream.Manager
}

func newEventTableHarness(t *testing.T, resync time.Duration) *eventTableHarness {
	t.Helper()
	meta := snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	client := fake.NewClientset()
	factory := informers.NewSharedInformerFactory(client, resync)
	reg := domain.New()
	clusterNotifier, err := snapshot.RegisterClusterEventsDomain(reg, factory, meta)
	require.NoError(t, err)
	namespaceNotifier, err := snapshot.RegisterNamespaceEventsDomain(reg, factory, meta)
	require.NoError(t, err)
	service := snapshot.NewServiceWithPermissions(reg, nil, meta, nil)
	manager := resourcestream.NewManager(nil, nil, nil, meta, nil)
	wireStreamObservers(manager, nil, service, nil, nil,
		[]*snapshot.EventTableChangeNotifier{clusterNotifier, namespaceNotifier}, nil)

	stop := make(chan struct{})
	t.Cleanup(func() {
		clusterNotifier.Stop()
		namespaceNotifier.Stop()
		close(stop)
	})
	factory.Start(stop)
	factory.WaitForCacheSync(stop)
	return &eventTableHarness{client: client, service: service, manager: manager}
}

func (h *eventTableHarness) subscribe(t *testing.T, domainName, scope string) *resourcestream.Subscription {
	t.Helper()
	selector, err := resourcestream.ParseStreamSelector("c1", domainName, scope)
	require.NoError(t, err)
	sub, err := h.manager.SubscribeSelector(selector)
	require.NoError(t, err)
	return sub
}

// rowNames reads the table the way a signal-triggered refetch does.
func (h *eventTableHarness) rowNames(t *testing.T, domainName, scope string) []string {
	t.Helper()
	snap, err := h.service.Build(context.Background(), domainName, "c1|"+scope)
	require.NoError(t, err)
	var names []string
	switch payload := snap.Payload.(type) {
	case snapshot.NamespaceEventsSnapshot:
		for _, row := range payload.Rows {
			names = append(names, row.Ref.Name)
		}
	case snapshot.ClusterEventsSnapshot:
		for _, row := range payload.Rows {
			names = append(names, row.Ref.Name)
		}
	default:
		t.Fatalf("unexpected %s payload %T", domainName, snap.Payload)
	}
	return names
}

func tableEvent(name, eventNamespace, objectKind, objectNamespace, rv string) *corev1.Event {
	return &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: eventNamespace, ResourceVersion: rv},
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
	h := newEventTableHarness(t, 0)
	prod := h.subscribe(t, "namespace-events", "namespace:prod")
	all := h.subscribe(t, "namespace-events", "namespace:all")
	other := h.subscribe(t, "namespace-events", "namespace:other")
	cluster := h.subscribe(t, "cluster-events", "cluster")

	// Prime the snapshot cache with the pre-change pages.
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:all"))
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:prod"))
	require.Empty(t, h.rowNames(t, "cluster-events", ""))

	ctx := context.Background()
	podEvent := tableEvent("web.1", "prod", "Pod", "prod", "10")
	_, err := h.client.CoreV1().Events("prod").Create(ctx, podEvent, metav1.CreateOptions{})
	require.NoError(t, err)

	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
	require.Equal(t, []string{"web.1"}, h.rowNames(t, "namespace-events", "namespace:all"))
	require.Equal(t, []string{"web.1"}, h.rowNames(t, "namespace-events", "namespace:prod"))
	requireQuiet(t, 750*time.Millisecond, map[string]*resourcestream.Subscription{
		"another namespace": other,
		"cluster events":    cluster,
	})

	nodeEvent := tableEvent("node-a.1", "default", "Node", "", "11")
	_, err = h.client.CoreV1().Events("default").Create(ctx, nodeEvent, metav1.CreateOptions{})
	require.NoError(t, err)

	requireEventDoorbell(t, cluster, "cluster-events", "")
	require.Equal(t, []string{"node-a.1"}, h.rowNames(t, "cluster-events", ""))
	requireQuiet(t, 750*time.Millisecond, map[string]*resourcestream.Subscription{
		"namespace prod": prod,
		"all namespaces": all,
	})

	require.NoError(t, h.client.CoreV1().Events("prod").Delete(ctx, "web.1", metav1.DeleteOptions{}))

	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:all"))
	require.Empty(t, h.rowNames(t, "namespace-events", "namespace:prod"))
}

// Informer resyncs re-deliver every cached Event with an unchanged
// resourceVersion. Those echoes carry no change, so they must not ring.
func TestEventTableDoorbellsIgnoreInformerResyncEchoes(t *testing.T) {
	h := newEventTableHarness(t, time.Second)
	prod := h.subscribe(t, "namespace-events", "namespace:prod")
	all := h.subscribe(t, "namespace-events", "namespace:all")
	cluster := h.subscribe(t, "cluster-events", "cluster")

	ctx := context.Background()
	_, err := h.client.CoreV1().Events("prod").Create(ctx, tableEvent("web.1", "prod", "Pod", "prod", "10"), metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = h.client.CoreV1().Events("default").Create(ctx, tableEvent("node-a.1", "default", "Node", "", "11"), metav1.CreateOptions{})
	require.NoError(t, err)
	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
	requireEventDoorbell(t, cluster, "cluster-events", "")

	// At least two one-second resyncs re-deliver both events.
	requireQuiet(t, 2500*time.Millisecond, map[string]*resourcestream.Subscription{
		"namespace prod": prod,
		"all namespaces": all,
		"cluster events": cluster,
	})

	// A real update still rings after the echoes were suppressed.
	updated := tableEvent("web.1", "prod", "Pod", "prod", "12")
	updated.Reason = "BackOff"
	_, err = h.client.CoreV1().Events("prod").Update(ctx, updated, metav1.UpdateOptions{})
	require.NoError(t, err)
	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
}
