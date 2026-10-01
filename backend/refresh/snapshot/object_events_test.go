package snapshot

import (
	"context"
	"fmt"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	corelisters "k8s.io/client-go/listers/core/v1"
	cgotesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
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
			Name:       "demo",
			Namespace:  "default",
			Kind:       "Pod",
			UID:        "demo-pod-uid",
			APIVersion: "v1",
		},
		Type:    "Warning",
		Reason:  "Failed",
		Message: "boom",
	}

	if err := indexer.Add(evt); err != nil {
		t.Fatalf("failed to seed event indexer: %v", err)
	}

	snap, err := builder.Build(context.Background(), "default:/v1:Pod:demo")
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
	if payload.Events[0].InvolvedObjectUID != "demo-pod-uid" {
		t.Fatalf("expected involved object uid to be preserved")
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
			Name:       "demo",
			Namespace:  "default",
			Kind:       "Pod",
			APIVersion: "v1",
		},
	}
	deployEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "evt-deploy",
			Namespace:       "default",
			ResourceVersion: "11",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:       "demo",
			Namespace:  "default",
			Kind:       "Deployment",
			APIVersion: "apps/v1",
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

	snap, err := builder.Build(context.Background(), "default:/v1:Pod:demo")
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

func TestObjectEventsBuilderPayloadCarriesEventIdentityAndFullInvolvedObjectRef(t *testing.T) {
	eventTime := metav1.NewTime(time.Date(2026, 5, 20, 12, 0, 0, 0, time.UTC))
	deploymentEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "api-scaled.17f",
			Namespace:       "default",
			UID:             "event-uid-1",
			ResourceVersion: "42",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:       "api",
			Namespace:  "default",
			Kind:       "Deployment",
			UID:        "deployment-uid-1",
			APIVersion: "apps/v1",
		},
		Type:           corev1.EventTypeNormal,
		Reason:         "ScalingReplicaSet",
		Message:        "Scaled up replica set",
		Count:          3,
		FirstTimestamp: eventTime,
		LastTimestamp:  eventTime,
	}
	otherEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-event",
			Namespace:       "default",
			ResourceVersion: "43",
		},
		InvolvedObject: corev1.ObjectReference{
			Name:       "api",
			Namespace:  "default",
			Kind:       "Pod",
			APIVersion: "v1",
		},
	}

	client := fake.NewClientset()
	events := []*corev1.Event{deploymentEvent, otherEvent}
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
		list.ResourceVersion = "42"
		for _, evt := range events {
			if selector.Matches(fields.Set{
				"involvedObject.name":       evt.InvolvedObject.Name,
				"involvedObject.namespace":  evt.InvolvedObject.Namespace,
				"involvedObject.kind":       evt.InvolvedObject.Kind,
				"involvedObject.apiVersion": evt.InvolvedObject.APIVersion,
			}) {
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
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"}
	scope := "default:apps/v1:Deployment:api"
	snap, err := builder.Build(WithClusterMeta(context.Background(), meta), scope)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if snap.Domain != objectEventsDomain {
		t.Fatalf("expected object-events domain, got %q", snap.Domain)
	}
	if snap.Scope != scope {
		t.Fatalf("expected scope %q, got %q", scope, snap.Scope)
	}
	payload, ok := snap.Payload.(ObjectEventsSnapshotPayload)
	if !ok {
		t.Fatalf("expected payload type ObjectEventsSnapshotPayload")
	}
	if payload.ClusterID != meta.ClusterID || payload.ClusterName != meta.ClusterName {
		t.Fatalf("payload lost cluster metadata: %+v", payload.ClusterMeta)
	}
	if len(payload.Events) != 1 {
		t.Fatalf("expected one filtered object event, got %d", len(payload.Events))
	}

	event := payload.Events[0]
	if event.Ref.Name != "api-scaled.17f" || event.Ref.UID != "event-uid-1" || event.ResourceVersion != "42" {
		t.Fatalf("event identity was not preserved: %+v", event)
	}
	if event.InvolvedObjectName != "api" ||
		event.InvolvedObjectKind != "Deployment" ||
		event.InvolvedObjectNamespace != "default" ||
		event.InvolvedObjectUID != "deployment-uid-1" {
		t.Fatalf("display involved-object fields were not preserved: %+v", event)
	}
	if event.InvolvedObject == nil || event.InvolvedObject.Ref == nil {
		t.Fatalf("expected full involved-object ref, got %+v", event.InvolvedObject)
	}
	ref := event.InvolvedObject.Ref
	if ref.ClusterID != "cluster-a" ||
		ref.Group != "apps" ||
		ref.Version != "v1" ||
		ref.Kind != "Deployment" ||
		ref.Namespace != "default" ||
		ref.Name != "api" ||
		ref.UID != "deployment-uid-1" {
		t.Fatalf("unexpected involved-object ref: %+v", ref)
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
		if got := payload.Events[0].Ref.Name; got != "evt-ack" {
			t.Fatalf("expected ACK event, got %q", got)
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
		if got := payload.Events[0].Ref.Name; got != "evt-kinda" {
			t.Fatalf("expected kinda.rocks event, got %q", got)
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
		if got := payload.Events[0].Ref.Name; got != "evt-ack" {
			t.Fatalf("expected ACK event, got %q", got)
		}
	})

	t.Run("legacy kind-only scope is rejected", func(t *testing.T) {
		client := fake.NewClientset()
		client.PrependReactor("list", "events", func(action cgotesting.Action) (bool, runtime.Object, error) {
			return true, nil, fmt.Errorf("unexpected API list call for invalid scope: %T", action)
		})

		builder := &ObjectEventsBuilder{client: client, eventSynced: func() bool { return false }}

		if _, err := builder.Build(context.Background(), "default:DBInstance:primary"); err == nil {
			t.Fatal("expected kind-only scope to be rejected")
		}
	})
}

// Truncation must keep the most recently observed events, as its warning
// claims; an index lookup returns events in arbitrary order.
func TestObjectEventsBuilderKeepsTheMostRecentEventsWhenTruncating(t *testing.T) {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		objectEventIndexName: objectEventIndex,
	})
	builder := &ObjectEventsBuilder{
		client:       fake.NewClientset(),
		eventLister:  corelisters.NewEventLister(indexer),
		eventIndexer: indexer,
		eventSynced:  func() bool { return true },
	}
	limit := config.SnapshotObjectEventsLimit
	base := time.Now().Add(-time.Hour)
	newest := make(map[string]bool, limit)
	for i := 0; i < 2*limit; i++ {
		name := fmt.Sprintf("evt-%04d", i)
		evt := &corev1.Event{
			ObjectMeta:     metav1.ObjectMeta{Name: name, Namespace: "default", ResourceVersion: fmt.Sprint(i + 1)},
			InvolvedObject: corev1.ObjectReference{Name: "demo", Namespace: "default", Kind: "Pod", APIVersion: "v1"},
			LastTimestamp:  metav1.NewTime(base.Add(time.Duration(i) * time.Second)),
		}
		if i >= limit {
			newest[name] = true
		}
		if err := indexer.Add(evt); err != nil {
			t.Fatalf("seed event: %v", err)
		}
	}

	snap, err := builder.Build(context.Background(), "default:/v1:Pod:demo")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	payload := snap.Payload.(ObjectEventsSnapshotPayload)
	if len(payload.Events) != limit || !snap.Stats.Truncated {
		t.Fatalf("expected a truncated page of %d events, got %d (truncated=%v)", limit, len(payload.Events), snap.Stats.Truncated)
	}
	for _, event := range payload.Events {
		if !newest[event.Ref.Name] {
			t.Fatalf("truncated page kept older event %s instead of the %d most recent", event.Ref.Name, limit)
		}
	}
}

// An object exists once per API group; its served versions are views of it.
// Events a controller recorded against another served version of the same
// group, or with no apiVersion at all, belong to the object.
func TestObjectEventsBuilderMatchesTheInvolvedObjectsGroupNotItsVersion(t *testing.T) {
	v1Event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: "evt-v1", Namespace: "default", ResourceVersion: "10"},
		InvolvedObject: corev1.ObjectReference{
			Name: "web", Namespace: "default", Kind: "HorizontalPodAutoscaler", APIVersion: "autoscaling/v1",
		},
	}
	unversionedEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: "evt-unversioned", Namespace: "default", ResourceVersion: "11"},
		InvolvedObject: corev1.ObjectReference{
			Name: "web", Namespace: "default", Kind: "HorizontalPodAutoscaler",
		},
	}
	otherGroupEvent := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: "evt-other-group", Namespace: "default", ResourceVersion: "12"},
		InvolvedObject: corev1.ObjectReference{
			Name: "web", Namespace: "default", Kind: "HorizontalPodAutoscaler", APIVersion: "example.io/v1",
		},
	}
	events := []*corev1.Event{v1Event, unversionedEvent, otherGroupEvent}
	scope := "default:autoscaling/v2:HorizontalPodAutoscaler:web"
	want := map[string]bool{"evt-v1": true, "evt-unversioned": true}

	requireNames := func(t *testing.T, builder *ObjectEventsBuilder) {
		t.Helper()
		snap, err := builder.Build(context.Background(), scope)
		if err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
		got := map[string]bool{}
		for _, event := range snap.Payload.(ObjectEventsSnapshotPayload).Events {
			got[event.Ref.Name] = true
		}
		if len(got) != len(want) || !got["evt-v1"] || !got["evt-unversioned"] {
			t.Fatalf("expected events %v, got %v", want, got)
		}
	}

	t.Run("cache index", func(t *testing.T) {
		indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
			objectEventIndexName: objectEventIndex,
		})
		for _, evt := range events {
			if err := indexer.Add(evt); err != nil {
				t.Fatalf("seed event: %v", err)
			}
		}
		requireNames(t, &ObjectEventsBuilder{
			client:       fake.NewClientset(),
			eventLister:  corelisters.NewEventLister(indexer),
			eventIndexer: indexer,
			eventSynced:  func() bool { return true },
		})
	})

	// Without the object index (AddIndexers failed after the informer started)
	// the builder scans the cache and must match exactly the same events.
	t.Run("cache scan", func(t *testing.T) {
		indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
		for _, evt := range events {
			if err := indexer.Add(evt); err != nil {
				t.Fatalf("seed event: %v", err)
			}
		}
		requireNames(t, &ObjectEventsBuilder{
			client:      fake.NewClientset(),
			eventLister: corelisters.NewEventLister(indexer),
			eventSynced: func() bool { return true },
		})
	})

	t.Run("api fallback", func(t *testing.T) {
		client := fake.NewClientset()
		client.PrependReactor("list", "events", func(action cgotesting.Action) (bool, runtime.Object, error) {
			selector := action.(cgotesting.ListAction).GetListRestrictions().Fields
			list := &corev1.EventList{}
			for _, evt := range events {
				if selector.Matches(fields.Set{
					"involvedObject.name":       evt.InvolvedObject.Name,
					"involvedObject.namespace":  evt.InvolvedObject.Namespace,
					"involvedObject.kind":       evt.InvolvedObject.Kind,
					"involvedObject.apiVersion": evt.InvolvedObject.APIVersion,
				}) {
					list.Items = append(list.Items, *evt)
				}
			}
			return true, list, nil
		})
		requireNames(t, &ObjectEventsBuilder{client: client, eventSynced: func() bool { return false }})
	})
}
