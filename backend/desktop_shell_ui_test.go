package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type uiShellFixture struct {
	shell  *DesktopShell
	ready  bool
	events []string
}

func newUIShellFixture() *uiShellFixture {
	fixture := &uiShellFixture{}
	fixture.shell = NewDesktopShell(nil, func() bool { return fixture.ready }, func(name string, _ ...interface{}) {
		fixture.events = append(fixture.events, name)
	}, NewLogger(100))
	return fixture
}

func viewMenuItem(t *testing.T, shell *DesktopShell, label string) *application.MenuItem {
	t.Helper()
	view := findSubmenu(t, shell.menu, "View")
	for index := 0; ; index++ {
		item := view.ItemAt(index)
		if item == nil {
			t.Fatalf("expected View menu item %q", label)
		}
		if item.Label() == label {
			return item
		}
	}
}

func TestToggleAppLogsPanelRequiresContext(t *testing.T) {
	fixture := newUIShellFixture()

	err := fixture.shell.ToggleAppLogsPanel()
	require.Error(t, err)
	require.False(t, fixture.shell.IsAppLogsPanelVisible())
}

func TestToggleDiagnosticsPanelRequiresContext(t *testing.T) {
	fixture := newUIShellFixture()

	err := fixture.shell.ToggleDiagnosticsPanel()
	require.Error(t, err)
	require.False(t, fixture.shell.IsDiagnosticsPanelVisible())
}

func TestToggleAppLogsPanelTogglesAndEmits(t *testing.T) {
	fixture := newUIShellFixture()
	CreateMenu(fixture.shell)
	fixture.ready = true

	err := fixture.shell.ToggleAppLogsPanel()
	require.NoError(t, err)
	require.True(t, fixture.shell.IsAppLogsPanelVisible())
	require.Equal(t, []string{"toggle-app-logs-panel"}, fixture.events)
	require.NotNil(t, viewMenuItem(t, fixture.shell, "Hide Application Logs"))
}

func TestToggleSidebarRequiresContext(t *testing.T) {
	fixture := newUIShellFixture()

	err := fixture.shell.ToggleSidebar()
	require.Error(t, err)
	require.True(t, fixture.shell.IsSidebarVisible())
}

func TestToggleSidebarTogglesAndEmits(t *testing.T) {
	fixture := newUIShellFixture()
	CreateMenu(fixture.shell)
	fixture.ready = true

	err := fixture.shell.ToggleSidebar()
	require.NoError(t, err)
	require.False(t, fixture.shell.IsSidebarVisible())
	require.Equal(t, []string{"toggle-sidebar"}, fixture.events)
	require.NotNil(t, viewMenuItem(t, fixture.shell, "Show Sidebar"))
}

func TestToggleObjectDiffRequiresContext(t *testing.T) {
	fixture := newUIShellFixture()

	err := fixture.shell.ToggleObjectDiff()
	require.Error(t, err)
}

func TestToggleObjectDiffEmits(t *testing.T) {
	fixture := newUIShellFixture()
	fixture.ready = true

	err := fixture.shell.ToggleObjectDiff()
	require.NoError(t, err)
	require.Equal(t, []string{"toggle-object-diff"}, fixture.events)
}

func TestUpdateMenuNoContext(t *testing.T) {
	fixture := newUIShellFixture()
	CreateMenu(fixture.shell)
	before := viewMenuItem(t, fixture.shell, "Hide Sidebar")
	fixture.shell.sidebarVisible = false

	fixture.shell.UpdateMenu()
	require.Same(t, before, viewMenuItem(t, fixture.shell, "Hide Sidebar"))
}

func TestUpdateMenuRefreshesPersistentNativeMenu(t *testing.T) {
	fixture := newUIShellFixture()
	CreateMenu(fixture.shell)
	before := viewMenuItem(t, fixture.shell, "Hide Sidebar")
	fixture.ready = true
	fixture.shell.sidebarVisible = false

	fixture.shell.UpdateMenu()
	after := viewMenuItem(t, fixture.shell, "Show Sidebar")
	require.NotSame(t, before, after)
}

func TestNativeMenuRefreshUsesPlatformOwner(t *testing.T) {
	for _, test := range []struct {
		goos string
		want string
	}{
		{goos: "linux", want: ""},
		{goos: "darwin", want: "set-application-menu"},
		{goos: "windows", want: ""},
		{goos: "unsupported", want: ""},
	} {
		t.Run(test.goos, func(t *testing.T) {
			called := ""

			applyNativeMenuRefresh(
				test.goos,
				func() { called = "set-application-menu" },
			)

			require.Equal(t, test.want, called)
		})
	}
}

func TestSetSidebarVisibleOnlyWhenChanged(t *testing.T) {
	fixture := newUIShellFixture()
	CreateMenu(fixture.shell)
	fixture.ready = true
	before := viewMenuItem(t, fixture.shell, "Hide Sidebar")

	fixture.shell.SetSidebarVisible(true)
	require.Same(t, before, viewMenuItem(t, fixture.shell, "Hide Sidebar"))

	fixture.shell.SetSidebarVisible(false)
	after := viewMenuItem(t, fixture.shell, "Show Sidebar")
	require.NotSame(t, before, after)
	require.False(t, fixture.shell.IsSidebarVisible())

	fixture.shell.SetSidebarVisible(false)
	require.Same(t, after, viewMenuItem(t, fixture.shell, "Show Sidebar"))
}

func TestSetAppLogsPanelVisibleOnlyWhenChanged(t *testing.T) {
	fixture := newUIShellFixture()
	CreateMenu(fixture.shell)
	fixture.ready = true
	before := viewMenuItem(t, fixture.shell, "Show Application Logs")

	fixture.shell.SetAppLogsPanelVisible(false)
	require.Same(t, before, viewMenuItem(t, fixture.shell, "Show Application Logs"))

	fixture.shell.SetAppLogsPanelVisible(true)
	after := viewMenuItem(t, fixture.shell, "Hide Application Logs")
	require.NotSame(t, before, after)
	require.True(t, fixture.shell.IsAppLogsPanelVisible())

	fixture.shell.SetAppLogsPanelVisible(true)
	require.Same(t, after, viewMenuItem(t, fixture.shell, "Hide Application Logs"))
}

func TestToggleDiagnosticsPanelTogglesAndEmits(t *testing.T) {
	fixture := newUIShellFixture()
	CreateMenu(fixture.shell)
	fixture.ready = true

	err := fixture.shell.ToggleDiagnosticsPanel()
	require.NoError(t, err)
	require.True(t, fixture.shell.IsDiagnosticsPanelVisible())
	require.Equal(t, []string{"toggle-diagnostics"}, fixture.events)
	require.NotNil(t, viewMenuItem(t, fixture.shell, "Hide Diagnostics Panel"))
}
