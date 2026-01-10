package objectcatalog

import (
	"testing"
	"time"
)

func TestCloneSetCopiesValues(t *testing.T) {
	if clone := cloneSet(nil); clone != nil {
		t.Fatalf("expected nil clone for nil source")
	}

	src := map[string]struct{}{"a": {}, "b": {}}
	clone := cloneSet(src)
	if len(clone) != 2 || clone["a"] != (struct{}{}) || clone["b"] != (struct{}{}) {
		t.Fatalf("expected clone to contain all entries, got %#v", clone)
	}
	clone["c"] = struct{}{}
	if _, ok := src["c"]; ok {
		t.Fatalf("expected clone to be independent of source")
	}
}

func newTestServiceForStreaming() *Service {
	return &Service{
		now:               time.Now,
		streamSubscribers: make(map[int]chan StreamingUpdate),
	}
}

func TestStreamingAggregatorFinalizePublishesState(t *testing.T) {
	svc := newTestServiceForStreaming()
	agg := newStreamingAggregator(svc)

	agg.emit(0, []Summary{{Name: "obj1", Kind: "Pod", Namespace: "default"}})
	if agg.start.IsZero() || agg.firstFlush.IsZero() {
		t.Fatalf("expected aggregator to record timing on first emit")
	}

	agg.kindSet["Pod"] = struct{}{}
	agg.namespaceSet["default"] = struct{}{}

	if agg.firstFlushLatency() < 0 {
		t.Fatalf("expected non-negative latency")
	}

	agg.finalize([]Descriptor{{Kind: "Pod", Resource: "pods"}}, true)

	svc.mu.Lock()
	defer svc.mu.Unlock()

	if !svc.cachesReady {
		t.Fatalf("expected cachesReady to be true after finalize")
	}
	if len(svc.sortedChunks) != 1 || len(svc.sortedChunks[0].items) != 1 {
		t.Fatalf("expected sortedChunks to be populated, got %#v", svc.sortedChunks)
	}
	if len(svc.cachedKinds) != 1 || svc.cachedKinds[0] != "Pod" {
		t.Fatalf("expected cachedKinds to include Pod, got %#v", svc.cachedKinds)
	}
	if len(svc.cachedNamespaces) != 1 || svc.cachedNamespaces[0] != "default" {
		t.Fatalf("expected cachedNamespaces to include default, got %#v", svc.cachedNamespaces)
	}
	if len(svc.cachedDescriptors) != 1 || svc.cachedDescriptors[0].Kind != "Pod" {
		t.Fatalf("expected cachedDescriptors to be set, got %#v", svc.cachedDescriptors)
	}
}

func TestEmitSummariesRoutesToAggregator(t *testing.T) {
	agg := newStreamingAggregator(newTestServiceForStreaming())
	summaries := []Summary{{Name: "obj"}}

	result, handled, err := emitSummaries(0, agg, summaries, nil, true)
	if err != nil || !handled {
		t.Fatalf("expected handled success, got handled=%v err=%v", handled, err)
	}
	if len(agg.cloneChunksLocked()) != 1 {
		t.Fatalf("expected aggregator to store summaries")
	}
	if len(result) != 1 {
		t.Fatalf("expected passthrough summaries, got %#v", result)
	}
}

func TestSubscribeStreamingAndBroadcast(t *testing.T) {
	svc := &Service{streamSubscribers: make(map[int]chan StreamingUpdate)}
	ch, unsubscribe := svc.SubscribeStreaming()
	defer unsubscribe()

	<-ch // initial readiness signal

	svc.broadcastStreaming(true)
	update := <-ch
	if !update.Ready {
		t.Fatalf("expected ready update")
	}
}

func TestServiceStreamingSubscriptionReceivesUpdates(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	updates, unsubscribe := svc.SubscribeStreaming()
	defer unsubscribe()

	select {
	case update := <-updates:
		if update.Ready {
			t.Fatalf("expected initial update to not be ready")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("timed out waiting for initial streaming update")
	}

	agg := newStreamingAggregator(svc)
	agg.emit(0, []Summary{{Kind: "Pod", Name: "p1"}})

	select {
	case update := <-updates:
		if update.Ready {
			t.Fatalf("expected non-final flush to report not ready")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("timed out waiting for flush update")
	}

	agg.finalize(nil, true)

	select {
	case update := <-updates:
		if !update.Ready {
			t.Fatalf("expected final update to report ready")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("timed out waiting for final update")
	}
}

func TestStreamingAggregatorEmitsOutOfOrderBatches(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	agg := newStreamingAggregator(svc)

	summaries := []Summary{
		{
			Kind:      "Namespace",
			Group:     "",
			Version:   "v1",
			Resource:  "namespaces",
			Name:      "default",
			Scope:     ScopeCluster,
			Namespace: "",
		},
	}

	agg.emit(5, summaries)

	result := svc.Query(QueryOptions{Limit: 10})
	if len(result.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(result.Items))
	}
	if result.Items[0].Name != "default" || result.Items[0].Kind != "Namespace" {
		t.Fatalf("unexpected item streamed: %+v", result.Items[0])
	}
}

func TestPruneMissingHonorsTTL(t *testing.T) {
	now := time.Now()
	svc := &Service{opts: Options{EvictionTTL: time.Minute}, now: func() time.Time { return now }}
	seen := map[string]time.Time{
		"a": now.Add(-2 * time.Minute),
		"b": now.Add(-30 * time.Second),
	}
	svc.pruneMissing(seen)
	if _, ok := seen["a"]; ok {
		t.Fatalf("expected expired entry a to be pruned")
	}
	if _, ok := seen["b"]; !ok {
		t.Fatalf("expected recent entry b to remain")
	}
}

func TestStreamingAggregatorCompleteIsNilSafe(t *testing.T) {
	var agg *streamingAggregator
	agg.complete(0)

	agg = &streamingAggregator{}
	agg.complete(1)
}
