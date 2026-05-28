package resourcestream

import "testing"

func TestClusterAdapterParsesSelector(t *testing.T) {
	adapter := NewClusterAdapter(nil)
	selector, err := adapter.ParseSelector("cluster-a", "namespace-workloads", "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selector.Cluster() != "cluster-a" || selector.DomainName() != "namespace-workloads" || selector.CanonicalScope() != "namespace:default" {
		t.Fatalf("unexpected selector: %#v", selector)
	}
}

func TestClusterAdapterSubscribeRequiresManager(t *testing.T) {
	adapter := NewClusterAdapter(map[string]*Manager{})
	selector, err := adapter.ParseSelector("cluster-a", "pods", "namespace:default")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if _, err := adapter.Subscribe(selector); err == nil {
		t.Fatalf("expected error for missing manager")
	}
}

func TestClusterAdapterResumeRequiresManager(t *testing.T) {
	adapter := NewClusterAdapter(map[string]*Manager{})
	selector, err := adapter.ParseSelector("cluster-a", "pods", "namespace:default")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if _, ok := adapter.Resume(selector, 1); ok {
		t.Fatalf("expected resume to fail without manager")
	}
}
