package snapshot

import (
	"context"
	"fmt"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
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

func TestObjectEventsBuilderAPIFallbackFiltersKind(t *testing.T) {
	podEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "evt-pod",
			Namespace:       "default",
			ResourceVersion: "10",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:      "demo",
			Namespace: "default",
			Kind:      "Pod",
		},
	}
	deployEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "evt-deploy",
			Namespace:       "default",
			ResourceVersion: "11",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:      "demo",
			Namespace: "default",
			Kind:      "Deployment",
		},
	}

	client := fake.NewClientset()
	events := []*corev1.Event{podEvent, deployEvent}
	client.PrependReactor("list", "events", func(action cgotesting.Action) (bool, runtime.Object, error) {
		listAction, ok := action.(cgotesting.ListAction)
		if !ok {
			return false, nil, fmt.Errorf("unexpected action %T", action)
		}
		selector := listAction.GetListRestrictions().Fields
		if selector == nil {
			selector = fields.Everything()
		}
		list := &corev1.EventList{}
		for _, evt := range events {
			match := selector.Matches(fields.Set{
				"involvedObject.name":      evt.InvolvedObject.Name,
				"involvedObject.namespace": evt.InvolvedObject.Namespace,
				"involvedObject.kind":      evt.InvolvedObject.Kind,
			})
			if match {
				list.Items = append(list.Items, *evt)
			}
		}
		return true, list, nil
	})
	builder := &ObjectEventsBuilder{
		client:       client,
		eventSynced:  func() bool { return false },
		eventLister:  nil,
		eventIndexer: nil,
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
	if payload.Events[0].InvolvedObjectKind != "Pod" {
		t.Fatalf("expected Pod event, got %q", payload.Events[0].InvolvedObjectKind)
	}
}
