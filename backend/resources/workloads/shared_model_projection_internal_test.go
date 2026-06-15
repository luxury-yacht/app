/*
 * backend/resources/workloads/shared_model_projection_internal_test.go
 *
 * Internal tests for shared-model projection helpers used by workload detail
 * builders.
 */

package workloads

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestWorkloadReplicaDisplay(t *testing.T) {
	replicas, ready := WorkloadReplicaDisplay(resourcemodel.WorkloadCommonFacts{
		DesiredReplicas: 5,
		CurrentReplicas: 3,
		ReadyReplicas:   2,
	})
	if replicas != "3/5" {
		t.Fatalf("replicas = %q, want %q", replicas, "3/5")
	}
	if ready != "2/3" {
		t.Fatalf("ready = %q, want %q", ready, "2/3")
	}
}

func TestWorkloadUtilization(t *testing.T) {
	// Empty pods -> aggregatePodAverages returns nils -> common.Format* returns "-".
	got := WorkloadUtilization(nil, nil)
	if got.CPURequest != "-" || got.CPULimit != "-" || got.CPUUsage != "-" ||
		got.MemRequest != "-" || got.MemLimit != "-" || got.MemUsage != "-" {
		t.Fatalf("WorkloadUtilization(nil,nil) = %+v, want all \"-\"", got)
	}
}
