package resourcestream

import "testing"

func TestClusterAdapterNormalizeScope(t *testing.T) {
	adapter := NewClusterAdapter(nil)
	scope, err := adapter.NormalizeScope("namespace-workloads", "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if scope != "namespace:default" {
		t.Fatalf("expected normalized scope, got %q", scope)
	}
}

func TestClusterAdapterSubscribeClusterRequiresManager(t *testing.T) {
	adapter := NewClusterAdapter(map[string]*Manager{})
	if _, err := adapter.SubscribeCluster("cluster-a", "pods", "namespace:default"); err == nil {
		t.Fatalf("expected error for missing manager")
	}
}

func TestClusterAdapterResumeClusterRequiresManager(t *testing.T) {
	adapter := NewClusterAdapter(map[string]*Manager{})
	if _, ok := adapter.ResumeCluster("cluster-a", "pods", "namespace:default", 1); ok {
		t.Fatalf("expected resume to fail without manager")
	}
}
