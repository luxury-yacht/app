package snapshot

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

func TestNodeMaintenanceDomainFiltersDrainsByClusterAndScope(t *testing.T) {
	suffix := time.Now().UnixNano()
	clusterA := fmt.Sprintf("phase8-cluster-a-%d", suffix)
	clusterB := fmt.Sprintf("phase8-cluster-b-%d", suffix)
	nodeName := fmt.Sprintf("phase8-worker-%d", suffix)
	store := nodemaintenance.GlobalStore()

	jobA := store.StartDrainForCluster(nodeName, restypes.DrainNodeOptions{Force: true}, clusterA, "Phase8 A")
	_ = store.StartDrainForCluster(nodeName, restypes.DrainNodeOptions{}, clusterB, "Phase8 B")

	reg := domain.New()
	if err := RegisterNodeMaintenanceDomain(reg); err != nil {
		t.Fatalf("RegisterNodeMaintenanceDomain returned error: %v", err)
	}
	cfg, ok := reg.Get("object-maintenance")
	if !ok {
		t.Fatal("object-maintenance domain not registered")
	}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: clusterA, ClusterName: "Phase8 A"})

	nodeSnapshot, err := cfg.BuildSnapshot(ctx, refresh.JoinClusterScope(clusterA, "node:"+nodeName))
	if err != nil {
		t.Fatalf("BuildSnapshot returned error: %v", err)
	}
	if nodeSnapshot.Scope != refresh.JoinClusterScope(clusterA, "node:"+nodeName) {
		t.Fatalf("expected normalized node scope, got %q", nodeSnapshot.Scope)
	}
	requireNodeMaintenancePayload(t, nodeSnapshot, clusterA, "Phase8 A", jobA.ID)

	aggregateSnapshot, err := cfg.BuildSnapshot(ctx, refresh.JoinClusterScope(clusterA, nodemaintenance.AggregateScope))
	if err != nil {
		t.Fatalf("BuildSnapshot aggregate returned error: %v", err)
	}
	requireNodeMaintenancePayload(t, aggregateSnapshot, clusterA, "Phase8 A", jobA.ID)
}

func requireNodeMaintenancePayload(t *testing.T, snapshot *refresh.Snapshot, clusterID, clusterName, jobID string) {
	t.Helper()
	payload, ok := snapshot.Payload.(nodemaintenance.Snapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snapshot.Payload)
	}
	if payload.ClusterID != clusterID || payload.ClusterName != clusterName {
		t.Fatalf("expected cluster metadata %s/%s, got %#v", clusterID, clusterName, payload)
	}
	if len(payload.Drains) != 1 {
		t.Fatalf("expected one cluster-filtered drain, got %#v", payload.Drains)
	}
	if payload.Drains[0].ID != jobID || payload.Drains[0].ClusterID != clusterID {
		t.Fatalf("expected cluster drain %s/%s, got %#v", clusterID, jobID, payload.Drains[0])
	}
	if snapshot.Stats.ItemCount != 1 {
		t.Fatalf("expected item count 1, got %d", snapshot.Stats.ItemCount)
	}
}
