package objectcatalog

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

func newTestWatchService() *Service {
	return &Service{
		now:               time.Now,
		items:             make(map[string]Summary),
		lastSeen:          make(map[string]time.Time),
		resources:         make(map[string]resourceDescriptor),
		streamSubscribers: make(map[int]chan StreamingUpdate),
		promoted:          make(map[string]*promotedDescriptor),
		health:            healthStatus{State: HealthStateUnknown},
		doneCh:            make(chan struct{}),
		clusterID:         "test-cluster",
		clusterName:       "test",
	}
}

func testDeploymentDescriptor() resourceDescriptor {
	return resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
}

func testNodeDescriptor() resourceDescriptor {
	return resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"},
		Namespaced: false,
		Kind:       "Node",
		Group:      "",
		Version:    "v1",
		Resource:   "nodes",
		Scope:      ScopeCluster,
	}
}

func registerDesc(svc *Service, desc resourceDescriptor) {
	svc.resources[desc.GVR.String()] = desc
}

func TestFlushAddEvent(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "my-deploy", Namespace: "default",
		UID: "uid-1", ResourceVersion: "100",
	}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "default", "my-deploy"),
		obj:       obj,
	}})

	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 {
		t.Fatalf("expected 1 item, got %d", result.TotalItems)
	}
	if result.Items[0].Name != "my-deploy" || result.Items[0].Kind != "Deployment" {
		t.Fatalf("unexpected item: %+v", result.Items[0])
	}
}

func TestFlushUpdateEvent(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	key := catalogKey(desc, "default", "my-deploy")
	svc.items[key] = Summary{Name: "my-deploy", Namespace: "default", Kind: "Deployment", ResourceVersion: "1"}
	svc.lastSeen[key] = time.Now()
	svc.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "my-deploy", Namespace: "default",
		UID: "uid-1", ResourceVersion: "200",
	}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventUpdate,
		gvr:       desc.GVR.String(),
		key:       key,
		obj:       obj,
	}})

	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 {
		t.Fatalf("expected 1 item, got %d", result.TotalItems)
	}
	if result.Items[0].ResourceVersion != "200" {
		t.Fatalf("expected rv 200, got %s", result.Items[0].ResourceVersion)
	}
}

func TestFlushDeleteEvent(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	key := catalogKey(desc, "default", "my-deploy")
	svc.items[key] = Summary{Name: "my-deploy", Namespace: "default", Kind: "Deployment"}
	svc.lastSeen[key] = time.Now()
	svc.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventDelete,
		gvr:       desc.GVR.String(),
		key:       key,
	}})

	if svc.Count() != 0 {
		t.Fatalf("expected 0 items, got %d", svc.Count())
	}
}

func TestFlushSkipsUnknownGVR(t *testing.T) {
	svc := newTestWatchService()
	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "orphan", Namespace: "default"}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       "unknown/v1/things",
		key:       "unknown/v1/things/default/orphan",
		obj:       obj,
	}})

	if svc.Count() != 0 {
		t.Fatalf("expected 0 items, got %d", svc.Count())
	}
}

func TestFlushSkipsDuringSyncInProgress(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)
	svc.syncInProgress.Store(true)

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "blocked", Namespace: "default"}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "default", "blocked"),
		obj:       obj,
	}})

	if svc.Count() != 0 {
		t.Fatalf("expected 0 items, got %d", svc.Count())
	}
}

func TestFlushClusterScopedResource(t *testing.T) {
	svc := newTestWatchService()
	desc := testNodeDescriptor()
	registerDesc(svc, desc)

	obj := &corev1.Node{ObjectMeta: metav1.ObjectMeta{
		Name: "node-1", UID: "node-uid", ResourceVersion: "50",
	}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "", "node-1"),
		obj:       obj,
	}})

	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 || result.Items[0].Scope != ScopeCluster {
		t.Fatalf("unexpected: %+v", result)
	}
}

func TestFlushBroadcastsToSubscribers(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ch, unsub := svc.SubscribeStreaming()
	defer unsub()
	<-ch // drain initial signal

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "x", Namespace: "default"}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "default", "x"),
		obj:       obj,
	}})

	select {
	case update := <-ch:
		if !update.Ready {
			t.Fatal("expected ready broadcast")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast")
	}
}

func TestWatchNotifierDebouncesBatch(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notifier := newWatchNotifier(ctx, svc)
	go notifier.run()

	for i := 0; i < 3; i++ {
		name := "pod-" + string(rune('a'+i))
		obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "default", UID: types.UID("uid-" + name),
		}}
		notifier.send(watchEvent{
			eventType: watchEventAdd,
			gvr:       desc.GVR.String(),
			key:       catalogKey(desc, "default", name),
			obj:       obj,
		})
	}

	time.Sleep(500 * time.Millisecond)
	if svc.Count() != 3 {
		t.Fatalf("expected 3 items, got %d", svc.Count())
	}
}

func TestWatchNotifierStopsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	notifier := newWatchNotifier(ctx, newTestWatchService())

	done := make(chan struct{})
	go func() { notifier.run(); close(done) }()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("run() did not exit")
	}
}

func TestRegisterWatchHandlersNilFactory(t *testing.T) {
	svc := newTestWatchService()
	notifier := newWatchNotifier(context.Background(), svc)
	registerWatchHandlers(nil, nil, notifier, svc)
	if len(notifier.pending) != 0 {
		t.Fatal("expected no events from nil factory")
	}
}

func TestMakeHandlerSkipsNoOpUpdates(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notifier := newWatchNotifier(ctx, svc)

	gr := schema.GroupResource{Group: "apps", Resource: "deployments"}
	handler := makeHandler(gr, notifier, svc)

	// Same ResourceVersion — should be filtered.
	oldObj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "same-rv", Namespace: "default", ResourceVersion: "42",
	}}
	newObj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "same-rv", Namespace: "default", ResourceVersion: "42",
	}}
	handler.OnUpdate(oldObj, newObj)

	select {
	case evt := <-notifier.pending:
		t.Fatalf("expected no event for same ResourceVersion, got %+v", evt)
	default:
	}

	// Different ResourceVersion — should enqueue.
	newObj2 := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "same-rv", Namespace: "default", ResourceVersion: "43",
	}}
	handler.OnUpdate(oldObj, newObj2)

	select {
	case evt := <-notifier.pending:
		if evt.eventType != watchEventUpdate {
			t.Fatalf("expected update event, got %d", evt.eventType)
		}
	default:
		t.Fatal("expected an update event for changed ResourceVersion")
	}
}

func TestReactiveUpdateEndToEnd(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notifier := newWatchNotifier(ctx, svc)
	go notifier.run()

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "e2e-pod", Namespace: "prod", UID: "e2e-uid", ResourceVersion: "1",
	}}
	notifier.send(watchEvent{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "prod", "e2e-pod"),
		obj:       obj,
	})

	time.Sleep(500 * time.Millisecond)
	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 || result.Items[0].Name != "e2e-pod" {
		t.Fatalf("add failed: %+v", result)
	}

	notifier.send(watchEvent{
		eventType: watchEventDelete,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "prod", "e2e-pod"),
	})

	time.Sleep(500 * time.Millisecond)
	result = svc.Query(QueryOptions{})
	if result.TotalItems != 0 {
		t.Fatalf("delete failed: %d items remain", result.TotalItems)
	}
}

func TestReactiveUpdatesDisabledByFlag(t *testing.T) {
	svc := NewService(Dependencies{Now: time.Now}, &Options{EnableReactiveUpdates: false})
	if svc.opts.EnableReactiveUpdates {
		t.Fatal("expected false when explicitly disabled")
	}
	svc2 := NewService(Dependencies{Now: time.Now}, nil)
	if !svc2.opts.EnableReactiveUpdates {
		t.Fatal("expected true by default")
	}
}
