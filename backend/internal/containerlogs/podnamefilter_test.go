package containerlogs

import "testing"

func TestPodNameFilter(t *testing.T) {
	filter, err := NewPodNameFilter("^api-", "-canary$")
	if err != nil {
		t.Fatalf("expected valid pod filter, got %v", err)
	}
	if !filter.Match("api-123") {
		t.Fatal("expected include regex to match pod name")
	}
	if filter.Match("web-123") {
		t.Fatal("expected missing include regex match to fail")
	}
	if filter.Match("api-123-canary") {
		t.Fatal("expected exclude regex to reject pod name")
	}
}

func TestPodNameFilterRejectsInvalidRegex(t *testing.T) {
	if _, err := NewPodNameFilter("[", ""); err == nil {
		t.Fatal("expected invalid include regex to fail")
	}
	if _, err := NewPodNameFilter("", "["); err == nil {
		t.Fatal("expected invalid exclude regex to fail")
	}
}
