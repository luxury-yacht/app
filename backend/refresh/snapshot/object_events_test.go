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

// TestObjectEventsBuilderDisambiguatesCollidingCRDsByAPIVersion verifies
// that two CRDs sharing a Kind+namespace+name in the same cluster get
// distinct event lists when the request scope carries a fully-qualified
// GVK. Without this fix the API field selector and the cache lookup both
// keyed on involvedObject.kind alone, so the events for both CRDs were
// merged. See the assertion-2 follow-up.
func TestObjectEventsBuilderDisambiguatesCollidingCRDsByAPIVersion(t *testing.T) {
	// Two events targeting two different DBInstance CRDs that share the
	// kind/namespace/name triple. They differ only in InvolvedObject.APIVersion.
	ackEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "evt-ack",
			Namespace:       "default",
			ResourceVersion: "100",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:       "primary",
			Namespace:  "default",
			Kind:       "DBInstance",
			APIVersion: "rds.services.k8s.aws/v1alpha1",
		},
		Reason:  "Provisioning",
		Message: "ACK provisioning RDS",
	}
	kindaEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "evt-kinda",
			Namespace:       "default",
			ResourceVersion: "101",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:       "primary",
			Namespace:  "default",
			Kind:       "DBInstance",
			APIVersion: "kinda.rocks/v1beta1",
		},
		Reason:  "Provisioning",
		Message: "kinda.rocks provisioning Postgres",
	}

	t.Run("api fallback filters by apiVersion", func(t *testing.T) {
		client := fake.NewClientset()
		events := []*corev1.Event{ackEvent, kindaEvent}
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
					"involvedObject.name":       evt.InvolvedObject.Name,
					"involvedObject.namespace":  evt.InvolvedObject.Namespace,
					"involvedObject.kind":       evt.InvolvedObject.Kind,
					"involvedObject.apiVersion": evt.InvolvedObject.APIVersion,
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

		// New GVK-form scope picks the ACK CRD specifically.
		snap, err := builder.Build(context.Background(), "default:rds.services.k8s.aws/v1alpha1:DBInstance:primary")
		if err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
		payload, ok := snap.Payload.(ObjectEventsSnapshotPayload)
		if !ok {
			t.Fatalf("expected payload type ObjectEventsSnapshotPayload")
		}
		if len(payload.Events) != 1 {
			t.Fatalf("expected exactly one event, got %d (events merged across CRDs?)", len(payload.Events))
		}
		if got := payload.Events[0].InvolvedObjectAPIVersion; got != "rds.services.k8s.aws/v1alpha1" {
			t.Fatalf("expected ACK event, got apiVersion=%q", got)
		}

		// And the kinda.rocks scope picks the OTHER CRD.
		snap, err = builder.Build(context.Background(), "default:kinda.rocks/v1beta1:DBInstance:primary")
		if err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
		payload, ok = snap.Payload.(ObjectEventsSnapshotPayload)
		if !ok {
			t.Fatalf("expected payload type ObjectEventsSnapshotPayload")
		}
		if len(payload.Events) != 1 {
			t.Fatalf("expected exactly one event, got %d", len(payload.Events))
		}
		if got := payload.Events[0].InvolvedObjectAPIVersion; got != "kinda.rocks/v1beta1" {
			t.Fatalf("expected kinda.rocks event, got apiVersion=%q", got)
		}
	})

	t.Run("cache index post-filters by apiVersion", func(t *testing.T) {
		client := fake.NewClientset()
		client.PrependReactor("list", "events", func(cgotesting.Action) (bool, runtime.Object, error) {
			return true, nil, fmt.Errorf("unexpected API list call")
		})

		indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
			objectEventIndexName: objectEventIndex,
		})
		lister := corelisters.NewEventLister(indexer)

		if err := indexer.Add(ackEvent); err != nil {
			t.Fatalf("failed to seed ACK event: %v", err)
		}
		if err := indexer.Add(kindaEvent); err != nil {
			t.Fatalf("failed to seed kinda event: %v", err)
		}

		builder := &ObjectEventsBuilder{
			client:       client,
			eventLister:  lister,
			eventIndexer: indexer,
			eventSynced:  func() bool { return true },
		}

		// The index keys both events under the same namespace|kind|name
		// bucket, so the index hit returns BOTH events. The post-filter
		// in listEventsByIndex must drop the wrong-apiVersion one.
		snap, err := builder.Build(context.Background(), "default:rds.services.k8s.aws/v1alpha1:DBInstance:primary")
		if err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
		payload, ok := snap.Payload.(ObjectEventsSnapshotPayload)
		if !ok {
			t.Fatalf("expected payload type ObjectEventsSnapshotPayload")
		}
		if len(payload.Events) != 1 {
			t.Fatalf("expected exactly one event, got %d (cache post-filter missed?)", len(payload.Events))
		}
		if got := payload.Events[0].InvolvedObjectAPIVersion; got != "rds.services.k8s.aws/v1alpha1" {
			t.Fatalf("expected ACK event, got apiVersion=%q", got)
		}
	})

	t.Run("legacy kind-only scope returns superset", func(t *testing.T) {
		// Legacy callers (pre-fix scope format "namespace:kind:name") get
		// no apiVersion filter and see all matching events. This preserves
		// backwards compat for any path that hasn't migrated.
		client := fake.NewClientset()
		events := []*corev1.Event{ackEvent, kindaEvent}
		client.PrependReactor("list", "events", func(action cgotesting.Action) (bool, runtime.Object, error) {
			listAction := action.(cgotesting.ListAction)
			selector := listAction.GetListRestrictions().Fields
			if selector == nil {
				selector = fields.Everything()
			}
			list := &corev1.EventList{}
			for _, evt := range events {
				match := selector.Matches(fields.Set{
					"involvedObject.name":       evt.InvolvedObject.Name,
					"involvedObject.namespace":  evt.InvolvedObject.Namespace,
					"involvedObject.kind":       evt.InvolvedObject.Kind,
					"involvedObject.apiVersion": evt.InvolvedObject.APIVersion,
				})
				if match {
					list.Items = append(list.Items, *evt)
				}
			}
			return true, list, nil
		})

		builder := &ObjectEventsBuilder{client: client, eventSynced: func() bool { return false }}

		snap, err := builder.Build(context.Background(), "default:DBInstance:primary")
		if err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
		payload := snap.Payload.(ObjectEventsSnapshotPayload)
		if len(payload.Events) != 2 {
			t.Fatalf("expected legacy superset of 2 events, got %d", len(payload.Events))
		}
	})
}
