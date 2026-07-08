package backend

import (
	"context"
	"runtime"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
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
		expected = []string{"Luxury Yacht", "File", "Edit", "View", "Window"}
	default:
		expected = []string{"File", "Edit", "View", "Window", "Help"}
	}
	if appDebugMenuEnabled {
		if runtime.GOOS == "darwin" {
			expected = []string{"Luxury Yacht", "File", "Edit", "View", "Window", "Debug"}
		} else {
			expected = []string{"File", "Edit", "View", "Window", "Debug", "Help"}
		}
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

func findSubmenu(t *testing.T, m *menu.Menu, label string) *menu.Menu {
	t.Helper()
	for _, item := range m.Items {
		if item.Label == label && item.SubMenu != nil {
			return item.SubMenu
		}
	}
	t.Fatalf("expected submenu %q", label)
	return nil
}

func menuLabels(m *menu.Menu) []string {
	labels := make([]string, 0, len(m.Items))
	for _, item := range m.Items {
		labels = append(labels, item.Label)
	}
	return labels
}

func TestCreateDebugMenuBuildsDebugOverlayEntries(t *testing.T) {
	app := &App{}
	m := menu.NewMenu()

	createDebugMenu(m, app)

	debugMenu := findSubmenu(t, m, "Debug")
	expected := []string{
		"Open Inspector",
		"",
		"Keyboard Focus Overlay",
		"Panel Debug Overlay",
		"Map Debug Overlay",
		"Icon Debug Overlay",
		"Error Boundary Tests",
	}
	if got := menuLabels(debugMenu); len(got) != len(expected) {
		t.Fatalf("expected %d debug menu items, got %d: %#v", len(expected), len(got), got)
	} else {
		for i, want := range expected {
			if got[i] != want {
				t.Fatalf("debug menu item %d label = %q, want %q", i, got[i], want)
			}
		}
	}
}

func TestEditMenuOffersStandardClipboardCommands(t *testing.T) {
	app := &App{}
	m := menu.NewMenu()

	createEditMenu(m, app)

	editMenu := findSubmenu(t, m, "Edit")
	expected := []string{"Cut", "Copy", "Paste", "Select All"}
	got := menuLabels(editMenu)
	if len(got) != len(expected) {
		t.Fatalf("expected edit menu labels %#v, got %#v", expected, got)
	}
	for i, want := range expected {
		if got[i] != want {
			t.Fatalf("edit menu item %d label = %q, want %q", i, got[i], want)
		}
	}
}

func TestEditMenuItemsEmitFrontendEvents(t *testing.T) {
	app := &App{Ctx: context.Background()}
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	m := menu.NewMenu()

	createEditMenu(m, app)

	editMenu := findSubmenu(t, m, "Edit")
	// Paste is skipped: its click handler reads the OS clipboard through the
	// Wails runtime, which needs a real Wails context.
	for _, label := range []string{"Cut", "Copy", "Select All"} {
		clicked := false
		for _, item := range editMenu.Items {
			if item.Label == label && item.Click != nil {
				item.Click(nil)
				clicked = true
			}
		}
		if !clicked {
			t.Fatalf("expected edit menu item %q with click handler", label)
		}
	}

	expected := []string{"menu:cut", "menu:copy", "menu:selectAll"}
	if len(events) != len(expected) {
		t.Fatalf("expected events %#v, got %#v", expected, events)
	}
	for i, want := range expected {
		if events[i] != want {
			t.Fatalf("event %d = %q, want %q", i, events[i], want)
		}
	}
}

func TestViewMenuKeepsApplicationLogsAndDiagnosticsEntries(t *testing.T) {
	app := &App{}
	m := menu.NewMenu()

	createViewMenu(m, app)

	viewMenu := findSubmenu(t, m, "View")
	labels := menuLabels(viewMenu)
	assertMenuContainsLabel(t, labels, "Show Application Logs")
	assertMenuContainsLabel(t, labels, "Show Diagnostics Panel")
}

func TestViewMenuOffersCommandPalette(t *testing.T) {
	app := &App{Ctx: context.Background()}
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	m := menu.NewMenu()

	createViewMenu(m, app)

	viewMenu := findSubmenu(t, m, "View")
	assertMenuContainsLabel(t, menuLabels(viewMenu), "Command Palette")

	clicked := false
	for _, item := range viewMenu.Items {
		if item.Label == "Command Palette" && item.Click != nil {
			item.Click(nil)
			clicked = true
		}
	}
	if !clicked {
		t.Fatal("expected View menu item \"Command Palette\" with click handler")
	}

	if len(events) != 1 || events[0] != "open-command-palette" {
		t.Fatalf("expected [open-command-palette], got %#v", events)
	}
}

func assertMenuContainsLabel(t *testing.T, labels []string, want string) {
	t.Helper()
	for _, label := range labels {
		if label == want {
			return
		}
	}
	t.Fatalf("expected menu labels to contain %q, got %#v", want, labels)
}

func TestDebugMenuItemsEmitFrontendEvents(t *testing.T) {
	app := &App{Ctx: context.Background()}
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	m := menu.NewMenu()

	createDebugMenu(m, app)

	debugMenu := findSubmenu(t, m, "Debug")
	for _, item := range debugMenu.Items {
		if item.Click != nil {
			item.Click(nil)
		}
	}

	expected := []string{
		"debug:open-inspector",
		"debug:toggle-focus-overlay",
		"debug:toggle-panel-overlay",
		"debug:toggle-map-overlay",
		"debug:toggle-icon-overlay",
		"debug:toggle-error-overlay",
	}
	if len(events) != len(expected) {
		t.Fatalf("expected events %#v, got %#v", expected, events)
	}
	for i, want := range expected {
		if events[i] != want {
			t.Fatalf("event %d = %q, want %q", i, events[i], want)
		}
	}
}
