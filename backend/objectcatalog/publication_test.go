package objectcatalog

import (
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestColdSyncPublishesOneFinalSignalAfterReplacement(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	agg := newStreamingAggregator(svc)
	ref := resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "karpenter.sh", Version: "v1", Kind: "NodePool", Resource: "nodepools", Name: "pool"}
	agg.emit(0, []Summary{{Ref: ref, Scope: ScopeCluster}})
	updates, unsubscribe := svc.SubscribeStreaming()
	defer unsubscribe()
	<-updates
	final := Summary{Ref: ref, Scope: ScopeCluster, ResourceVersion: "enriched"}
	run := catalogSync{service: svc, aggregator: agg, newItems: map[string]Summary{"pool": final}}
	svc.opts.EvictionTTL = time.Minute
	svc.now = func() time.Time {
		if len(updates) != 0 {
			t.Error("final signal was sent before replacement publication finished")
		}
		return time.Now()
	}
	// Partial sync signals are not coalesced, exposing duplicate final publication.
	run.publish(nil, errors.New("one descriptor failed"))
	if got := len(updates); got != 1 {
		t.Fatalf("expected one final signal, got %d", got)
	}
	if update := <-updates; update.Ready {
		t.Fatal("partial collection must not advertise success")
	}
	result := svc.Query(QueryOptions{Limit: 10})
	if len(result.Items) != 1 || result.Items[0].ResourceVersion != "enriched" {
		t.Fatalf("subscriber read did not see final replacement: %+v", result.Items)
	}
	run.publish(nil, nil)
	if got := len(updates); got != 1 {
		t.Fatalf("expected one successful final signal, got %d", got)
	}
	if update := <-updates; !update.Ready {
		t.Fatal("successful collection must advertise readiness")
	}
}
