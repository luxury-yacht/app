package eventstream

import (
	"sync"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func TestBroadcastCanFinishWhileSubscriberCancels(t *testing.T) {
	manager := &Manager{
		logger:      applog.Noop,
		subscribers: make(map[string]map[uint64]*subscription),
		buffers:     make(map[string]*eventBuffer),
		sequences:   make(map[string]uint64),
	}
	for range 200 {
		ch, cancel := manager.Subscribe("namespace:default")
		_, sequence, targets := manager.prepareBroadcast("namespace:default", Entry{Name: "admitted"})
		var workers sync.WaitGroup
		workers.Add(2)
		go func() {
			defer workers.Done()
			manager.deliverBroadcast("namespace:default", targets, StreamEvent{Sequence: sequence})
		}()
		go func() {
			defer workers.Done()
			cancel()
		}()
		workers.Wait()
		for range ch {
		}
		// Cleanup from an old delivery must not close its replacement subscriber.
		fresh, closeFresh := manager.Subscribe("namespace:default")
		manager.broadcast("namespace:default", Entry{Name: "replacement"})
		event, ok := <-fresh
		if !ok || event.Entry.Name != "replacement" {
			t.Fatalf("replacement subscription lost its event: %+v, open=%v", event, ok)
		}
		closeFresh()
	}
}

func TestSlowEventSubscriberKeepsNewestEventsAndReportsDrops(t *testing.T) {
	recorder := telemetry.NewRecorder()
	manager := &Manager{
		logger: applog.Noop, telemetry: recorder,
		subscribers: make(map[string]map[uint64]*subscription),
		buffers:     make(map[string]*eventBuffer),
		sequences:   make(map[string]uint64),
	}
	ch, cancel := manager.Subscribe("cluster")
	defer cancel()
	for range config.EventStreamSubscriberBufferSize + 1 {
		manager.broadcast("cluster", Entry{Name: "event"})
	}
	for sequence := uint64(2); sequence <= config.EventStreamSubscriberBufferSize+1; sequence++ {
		event, open := <-ch
		if !open || event.Sequence != sequence {
			t.Fatalf("backlog lost its newest ordered events: got %+v, open=%v, want sequence %d", event, open, sequence)
		}
	}
	for _, status := range recorder.SnapshotSummary().Streams {
		if status.Name == telemetry.StreamEvents && status.Leaf == "cluster" {
			if status.DroppedMessages != 1 || status.TotalMessages != config.EventStreamSubscriberBufferSize+1 {
				t.Fatalf("incorrect backlog telemetry: %+v", status)
			}
			return
		}
	}
	t.Fatal("event backlog telemetry was not published")
}
