package backend

import (
	"math"
	"net/http"
	"testing"
	"time"
)

func TestKubernetesAPIMetricsRegistryRecordsRequestRatesAndStatuses(t *testing.T) {
	registry := newKubernetesAPIMetricsRegistry()
	metrics := registry.getOrCreate(ClusterMeta{ID: "cluster-a", Name: "Prod"}, 500, 1000)
	now := time.Unix(1_700_000_000, 0)

	metrics.record(http.StatusOK, now)
	metrics.record(http.StatusOK, now)
	metrics.record(http.StatusTooManyRequests, now.Add(time.Second))
	metrics.record(http.StatusInternalServerError, now.Add(2*time.Second))
	metrics.record(0, now.Add(2*time.Second))

	rows := registry.snapshot(now.Add(2 * time.Second))
	if len(rows) != 1 {
		t.Fatalf("expected 1 diagnostics row, got %d", len(rows))
	}
	row := rows[0]
	if row.ClusterID != "cluster-a" || row.ClusterName != "Prod" {
		t.Fatalf("unexpected cluster identity: %#v", row)
	}
	if row.ConfiguredQPS != 500 || row.ConfiguredBurst != 1000 {
		t.Fatalf("unexpected configured limits: %#v", row)
	}
	if row.QPS1s != 2 || math.Abs(row.QPS10s-0.5) > 0.001 || math.Abs(row.QPS60s-0.083) > 0.001 {
		t.Fatalf("unexpected qps windows: %#v", row)
	}
	if row.PeakQPS1s != 2 || row.TotalRequests != 5 {
		t.Fatalf("unexpected request totals: %#v", row)
	}
	if row.Status2xx != 2 || row.Status429 != 1 || row.Status4xx != 1 || row.Status5xx != 1 || row.Errors != 1 {
		t.Fatalf("unexpected status counters: %#v", row)
	}
	if row.LastRequestMs != now.Add(2*time.Second).UnixMilli() {
		t.Fatalf("unexpected last request timestamp: %d", row.LastRequestMs)
	}
}

func TestKubernetesAPIMetricsRegistryRemovesCluster(t *testing.T) {
	registry := newKubernetesAPIMetricsRegistry()
	registry.getOrCreate(ClusterMeta{ID: "cluster-a", Name: "Prod"}, 500, 1000)
	registry.remove("cluster-a")

	rows := registry.snapshot(time.Now())
	if len(rows) != 0 {
		t.Fatalf("expected removed cluster to be absent, got %#v", rows)
	}
}
