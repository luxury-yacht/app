package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/capabilities"
)

func TestQueryPermissions_EmptyBatch(t *testing.T) {
	app := &App{}
	resp, err := app.QueryPermissions(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Results) != 0 {
		t.Errorf("expected 0 results, got %d", len(resp.Results))
	}
}

func TestQueryPermissions_ValidationErrors(t *testing.T) {
	app := &App{}

	checks := []capabilities.PermissionQuery{
		{ID: "", Verb: "list", ResourceKind: "Pod", ClusterId: "c1"},
		{ID: "1", Verb: "", ResourceKind: "Pod", ClusterId: "c1"},
		{ID: "2", Verb: "list", ResourceKind: "", ClusterId: "c1"},
		{ID: "3", Verb: "list", ResourceKind: "Pod", ClusterId: ""},
	}

	resp, err := app.QueryPermissions(checks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(resp.Results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(resp.Results))
	}

	for i, r := range resp.Results {
		if r.Source != "error" {
			t.Errorf("result[%d]: expected source 'error', got %q", i, r.Source)
		}
		if r.Error == "" {
			t.Errorf("result[%d]: expected non-empty error", i)
		}
	}
}
