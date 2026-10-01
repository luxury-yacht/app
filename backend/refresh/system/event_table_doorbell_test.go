package system

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
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
	client   *fake.Clientset
	service  *snapshot.Service
	manager  *resourcestream.Manager
	registry *domain.Registry
}

func newEventTableHarness(t *testing.T, resync time.Duration) *eventTableHarness {
	t.Helper()
	return newEventTableHarnessWith(t, resync, nil, nil)
}

// newEventTableHarnessWith seeds the cluster with objects and runs beforeStart
// (for example a spill restore) after registration but before the informers start.
func newEventTableHarnessWith(
	t *testing.T,
	resync time.Duration,
	objects []runtime.Object,
	beforeStart func(*domain.Registry),
) *eventTableHarness {
	t.Helper()
	meta := snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	client := fake.NewClientset(objects...)
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

	if beforeStart != nil {
		beforeStart(reg)
	}

	stop := make(chan struct{})
	t.Cleanup(func() {
		clusterNotifier.Stop()
		namespaceNotifier.Stop()
		close(stop)
	})
	factory.Start(stop)
	factory.WaitForCacheSync(stop)
	return &eventTableHarness{client: client, service: service, manager: manager, registry: reg}
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

// Rows restored from a spill for Events that expired while the app was closed
// or the cluster was Cold are swept by Reconcile once the informers sync. The
// tables must hear that removal, or the expired rows stay on screen until the
// next real event in their scope.
func TestEventTableDoorbellsRingWhenReconcileDropsRestoredRows(t *testing.T) {
	spillDir := t.TempDir()
	before := newEventTableHarnessWith(t, 0, []runtime.Object{
		tableEvent("web.1", "prod", "Pod", "prod", "10"),
		tableEvent("node-a.1", "default", "Node", "", "11"),
	}, nil)
	require.Equal(t, []string{"web.1"}, before.rowNames(t, "namespace-events", "namespace:all"))
	require.Equal(t, []string{"node-a.1"}, before.rowNames(t, "cluster-events", ""))
	require.NoError(t, before.registry.SpillMaintainedStores(spillDir))

	// Both Events expired before the next start; only the spill still has them.
	after := newEventTableHarnessWith(t, 0, nil, func(reg *domain.Registry) {
		require.NoError(t, reg.RestoreMaintainedStores(spillDir))
	})
	prod := after.subscribe(t, "namespace-events", "namespace:prod")
	all := after.subscribe(t, "namespace-events", "namespace:all")
	cluster := after.subscribe(t, "cluster-events", "cluster")
	require.Equal(t, []string{"web.1"}, after.rowNames(t, "namespace-events", "namespace:all"),
		"the restored row is served until Reconcile runs")

	after.registry.ReconcileMaintainedStores()

	requireEventDoorbell(t, prod, "namespace-events", "namespace:prod")
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")
	requireEventDoorbell(t, cluster, "cluster-events", "")
	require.Empty(t, after.rowNames(t, "namespace-events", "namespace:all"))
	require.Empty(t, after.rowNames(t, "cluster-events", ""))
}

// The production constructor must hand both event table notifiers to the
// subsystem, wire them to its resource stream, and silence them on teardown;
// otherwise the tables lose their doorbell, or a torn-down cluster keeps ringing.
func TestSubsystemWiresAndStopsEventTableDoorbells(t *testing.T) {
	kube := fake.NewClientset()
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		attrs := review.Spec.ResourceAttributes
		review.Status.Allowed = attrs != nil && attrs.Resource == "events"
		return true, review, nil
	})
	subsystem, err := NewSubsystemWithServices(Config{
		KubernetesClient: kube, APIExtensionsClient: apiextensionsfake.NewClientset(),
		DynamicClient: dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()), ClusterID: "c1",
		Logger: applog.Noop, ObjectDetailsProvider: noopObjectDetailProvider{},
		NodeMaintenanceStore: nodemaintenance.NewStore(5), ResyncInterval: time.Minute,
	})
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(func() {
		cancel()
		subsystem.StopDoorbellNotifiers()
		subsystem.ResourceStream.Stop()
		subsystem.IngestManager.Stop()
		_ = subsystem.InformerFactory.Shutdown()
	})

	domains := make([]string, 0, len(subsystem.EventTableNotifiers))
	for _, notifier := range subsystem.EventTableNotifiers {
		domains = append(domains, notifier.Domain())
	}
	require.ElementsMatch(t, []string{"cluster-events", "namespace-events"}, domains)

	require.NoError(t, subsystem.InformerFactory.Start(ctx))
	selector, err := resourcestream.ParseStreamSelector("c1", "namespace-events", "namespace:all")
	require.NoError(t, err)
	all, err := subsystem.ResourceStream.SubscribeSelector(selector)
	require.NoError(t, err)
	defer all.Cancel()

	_, err = kube.CoreV1().Events("prod").Create(context.Background(), tableEvent("web.1", "prod", "Pod", "prod", "10"), metav1.CreateOptions{})
	require.NoError(t, err)
	requireEventDoorbell(t, all, "namespace-events", "namespace:all")

	subsystem.StopDoorbellNotifiers()
	_, err = kube.CoreV1().Events("prod").Create(context.Background(), tableEvent("web.2", "prod", "Pod", "prod", "11"), metav1.CreateOptions{})
	require.NoError(t, err)
	requireQuiet(t, 750*time.Millisecond, map[string]*resourcestream.Subscription{"after teardown": all})
}
