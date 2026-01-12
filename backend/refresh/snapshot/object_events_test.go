package snapshot

import (
	"context"
	"fmt"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	corelisters "k8s.io/client-go/listers/core/v1"
	cgotesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"
)

func TestObjectEventsBuilderUsesCacheWhenSynced(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "events", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("unexpected API list call")
	})

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		objectEventIndexName: objectEventIndex,
	})
	lister := corelisters.NewEventLister(indexer)

	builder := &ObjectEventsBuilder{
		client:       client,
		eventLister:  lister,
		eventIndexer: indexer,
		eventSynced:  func() bool { return true },
	}

	evt := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "evt-1",
			Namespace:       "default",
			ResourceVersion: "123",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:      "demo",
			Namespace: "default",
			Kind:      "Pod",
		},
		Type:    "Warning",
		Reason:  "Failed",
		Message: "boom",
	}

	if err := indexer.Add(evt); err != nil {
		t.Fatalf("failed to seed event indexer: %v", err)
	}

	snap, err := builder.Build(context.Background(), "default:Pod:demo")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload, ok := snap.Payload.(ObjectEventsSnapshotPayload)
	if !ok {
		t.Fatalf("expected payload type ObjectEventsSnapshotPayload")
	}
	if len(payload.Events) != 1 {
		t.Fatalf("expected one event summary, got %d", len(payload.Events))
	}
	if payload.Events[0].InvolvedObjectName != "demo" {
		t.Fatalf("expected event for demo object")
	}
	if snap.Version != 123 {
		t.Fatalf("expected version 123, got %d", snap.Version)
	}
}
