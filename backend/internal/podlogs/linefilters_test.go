package podlogs

import "testing"

func TestLineFilterMatches(t *testing.T) {
	filter, err := NewLineFilter("error|warn", "debug")
	if err != nil {
		t.Fatalf("NewLineFilter returned error: %v", err)
	}

	if !filter.Matches("warn: useful signal") {
		t.Fatal("expected include match to pass")
	}
	if filter.Matches("debug: useful signal") {
		t.Fatal("expected exclude match to fail")
	}
	if filter.Matches("info: useful signal") {
		t.Fatal("expected missing include match to fail")
	}
}

func TestLineFilterRejectsInvalidRegex(t *testing.T) {
	if _, err := NewLineFilter("[", ""); err == nil {
		t.Fatal("expected invalid include regex to fail")
	}
	if _, err := NewLineFilter("", "["); err == nil {
		t.Fatal("expected invalid exclude regex to fail")
	}
}
