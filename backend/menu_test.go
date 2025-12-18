package backend

import (
	"runtime"
	"testing"
)

func TestCreateMenuBuildsEntries(t *testing.T) {
	app := &App{}
	m := CreateMenu(app)

	if m == nil {
		t.Fatal("expected menu to be created")
	}
	if len(m.Items) == 0 {
		t.Fatal("expected menu to contain items")
	}
}

func TestCreateMenuTopLevelLabels(t *testing.T) {
	app := &App{}
	m := CreateMenu(app)

	var expected []string
	switch runtime.GOOS {
	case "darwin":
		expected = []string{"Luxury Yacht", "Edit", "View", "Window"}
	default:
		expected = []string{"File", "Help", "Edit", "View", "Window"}
	}

	if len(m.Items) != len(expected) {
		t.Fatalf("expected %d top-level menu items, got %d", len(expected), len(m.Items))
	}
	for i, want := range expected {
		if m.Items[i].Label != want {
			t.Fatalf("menu item %d label = %q, want %q", i, m.Items[i].Label, want)
		}
	}
}
