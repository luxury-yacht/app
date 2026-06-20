package eventstream

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func TestManagerBroadcastsToSubscribers(t *testing.T) {
	client := fake.NewClientset()
	factory := informers.NewSharedInformerFactory(client, 0)
	informer := factory.Core().V1().Events()

	manager := NewManager(informer, applog.Noop, telemetry.NewRecorder(), "cluster-a")

	stopCh := make(chan struct{})
	defer close(stopCh)

	go factory.Start(stopCh)
	cache.WaitForCacheSync(stopCh, informer.Informer().HasSynced)

	ach, cancel := manager.Subscribe("namespace:default")
	defer cancel()

	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-event",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:       "Pod",
			Name:       "web-123",
			Namespace:  "default",
			UID:        "pod-uid-1",
			APIVersion: "v1",
		},
		Message: "Pod restarted",
		Type:    "Warning",
	}

	manager.handleEvent(event)

	select {
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for event")
	case streamEvent, ok := <-ach:
		if !ok {
			t.Fatalf("subscription channel closed")
		}
		if streamEvent.Sequence == 0 {
			t.Fatalf("expected sequence to be set")
		}
		if streamEvent.Entry.Name != "test-event" || streamEvent.Entry.Namespace != "default" {
			t.Fatalf("unexpected entry: %+v", streamEvent.Entry)
		}
		if streamEvent.Entry.ClusterID != "cluster-a" {
			t.Fatalf("expected cluster id to be preserved, got %+v", streamEvent.Entry)
		}
		if streamEvent.Entry.ObjectUID != "pod-uid-1" {
			t.Fatalf("expected object uid to be preserved, got %+v", streamEvent.Entry)
		}
		if streamEvent.Entry.ObjectAPIVersion != "v1" {
			t.Fatalf("expected object apiVersion to be preserved, got %+v", streamEvent.Entry)
		}
		if streamEvent.Entry.InvolvedObject == nil || streamEvent.Entry.InvolvedObject.Ref == nil {
			t.Fatalf("expected involved object ref to be preserved, got %+v", streamEvent.Entry.InvolvedObject)
		}
		ref := streamEvent.Entry.InvolvedObject.Ref
		if ref.ClusterID != "cluster-a" ||
			ref.Group != "" ||
			ref.Version != "v1" ||
			ref.Kind != "Pod" ||
			ref.Namespace != "default" ||
			ref.Name != "web-123" {
			t.Fatalf("unexpected involved object ref: %+v", ref)
		}
	}
}

func TestManagerOnlyBroadcastsClusterScopedEventsToClusterSubscribers(t *testing.T) {
	client := fake.NewClientset()
	factory := informers.NewSharedInformerFactory(client, 0)
	informer := factory.Core().V1().Events()

	manager := NewManager(informer, applog.Noop, telemetry.NewRecorder(), "cluster-a")

	stopCh := make(chan struct{})
	defer close(stopCh)

	go factory.Start(stopCh)
	cache.WaitForCacheSync(stopCh, informer.Informer().HasSynced)

	clusterCh, cancelCluster := manager.Subscribe("cluster")
	defer cancelCluster()
	namespaceCh, cancelNamespace := manager.Subscribe("namespace:default")
	defer cancelNamespace()

	clusterScoped := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cluster-event",
			Namespace: "kube-system",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind: "Node",
			Name: "node-a",
		},
		Message: "Node updated",
		Type:    "Normal",
	}

	namespaced := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "ns-event",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "web-123",
			Namespace: "default",
		},
		Message: "Pod restarted",
		Type:    "Warning",
	}

	manager.handleEvent(clusterScoped)

	select {
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for cluster-scoped event")
	case streamEvent := <-clusterCh:
		if streamEvent.Entry.Name != "cluster-event" {
			t.Fatalf("unexpected cluster entry: %+v", streamEvent.Entry)
		}
	}

	manager.handleEvent(namespaced)

	select {
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for namespace event")
	case streamEvent := <-namespaceCh:
		if streamEvent.Entry.Name != "ns-event" {
			t.Fatalf("unexpected namespace entry: %+v", streamEvent.Entry)
		}
	}

	select {
	case streamEvent := <-clusterCh:
		t.Fatalf("did not expect namespaced event on cluster stream: %+v", streamEvent.Entry)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestManagerEvictsResumeBufferWhenLastSubscriberCancels(t *testing.T) {
	manager := &Manager{
		logger:      applog.Noop,
		subscribers: make(map[string]map[uint64]*subscription),
		buffers:     make(map[string]*eventBuffer),
		sequences:   make(map[string]uint64),
	}

	_, cancel := manager.Subscribe("namespace:default")

	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-event",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "web-123",
			Namespace: "default",
		},
		Message: "Pod restarted",
		Type:    "Warning",
	}

	manager.handleEvent(event)

	if _, ok := manager.buffers["namespace:default"]; !ok {
		t.Fatal("expected resume buffer to be created")
	}

	cancel()

	if _, ok := manager.buffers["namespace:default"]; ok {
		t.Fatal("expected resume buffer to be evicted")
	}
	if _, ok := manager.sequences["namespace:default"]; ok {
		t.Fatal("expected sequence state to be evicted")
	}

	manager.handleEvent(event)

	if _, ok := manager.buffers["namespace:default"]; ok {
		t.Fatal("expected no resume buffer without subscribers")
	}
}

func TestManagerSubscribeWithResumeReplaysAndSubscribes(t *testing.T) {
	manager := &Manager{
		logger:      applog.Noop,
		subscribers: make(map[string]map[uint64]*subscription),
		buffers:     make(map[string]*eventBuffer),
		sequences:   make(map[string]uint64),
	}

	buffer := newEventBuffer(2)
	buffer.Add(bufferedEvent{
		sequence: 1,
		entry: Entry{
			Kind:    "Event",
			Name:    "first",
			Message: "first message",
		},
	})
	buffer.Add(bufferedEvent{
		sequence: 2,
		entry: Entry{
			Kind:    "Event",
			Name:    "second",
			Message: "second message",
		},
	})
	manager.buffers["cluster"] = buffer
	manager.sequences["cluster"] = 2

	resumeEvents, ch, cancel, ok, limited := manager.SubscribeWithResume("cluster", 1)
	if limited {
		t.Fatal("expected resume subscription to succeed without limit")
	}
	if !ok {
		t.Fatal("expected resume subscription to be available")
	}
	defer cancel()

	if len(resumeEvents) != 1 || resumeEvents[0].Sequence != 2 {
		t.Fatalf("unexpected resume events: %+v", resumeEvents)
	}

	manager.broadcast("cluster", Entry{
		Kind:    "Event",
		Name:    "live",
		Message: "live message",
	})

	select {
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live event")
	case event := <-ch:
		if event.Sequence != 3 {
			t.Fatalf("expected sequence 3, got %d", event.Sequence)
		}
		if event.Entry.Name != "live" {
			t.Fatalf("unexpected entry: %+v", event.Entry)
		}
	}
}

func TestEventBufferDetectsExpiredResumeAfterOverflow(t *testing.T) {
	buffer := newEventBuffer(2)
	buffer.Add(bufferedEvent{sequence: 1, entry: Entry{Name: "one"}})
	buffer.Add(bufferedEvent{sequence: 2, entry: Entry{Name: "two"}})
	buffer.Add(bufferedEvent{sequence: 3, entry: Entry{Name: "three"}})

	if _, ok := buffer.Since(1); ok {
		t.Fatal("expected resume before oldest buffered event to fail")
	}

	events, ok := buffer.Since(2)
	if !ok {
		t.Fatal("expected resume from retained sequence to succeed")
	}
	if len(events) != 1 || events[0].sequence != 3 || events[0].entry.Name != "three" {
		t.Fatalf("unexpected resume events: %+v", events)
	}
}

func TestBroadcastRecordsDeliveryPerScope(t *testing.T) {
	client := fake.NewClientset()
	factory := informers.NewSharedInformerFactory(client, 0)
	informer := factory.Core().V1().Events()
	recorder := telemetry.NewRecorder()
	manager := NewManager(informer, applog.Noop, recorder, "cluster-a")

	ch, cancel := manager.Subscribe("namespace:demo")
	defer cancel()

	manager.broadcast("namespace:demo", Entry{Kind: "Event", Name: "live", Message: "m"})
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for event delivery")
	}

	// Delivery is attributed to the event scope so diagnostics show one events row
	// per scope (cluster / namespace:<name>) instead of one aggregate.
	var got telemetry.StreamStatus
	for _, s := range recorder.SnapshotSummary().Streams {
		if s.Domain == "namespace:demo" {
			got = s
		}
	}
	if got.Name != telemetry.StreamEvents {
		t.Fatalf("expected events delivery attributed to scope namespace:demo, got streams %+v", recorder.SnapshotSummary().Streams)
	}
	if got.TotalMessages < 1 {
		t.Fatalf("expected >=1 delivered for scope namespace:demo, got %d", got.TotalMessages)
	}
}
