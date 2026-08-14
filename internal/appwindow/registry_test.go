package appwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestVisibilityPreservesPlatformStartupContract(t *testing.T) {
	for _, test := range []struct {
		goos       string
		wantHidden bool
	}{
		{goos: "darwin", wantHidden: true},
		{goos: "windows", wantHidden: true},
		{goos: "linux", wantHidden: false},
	} {
		t.Run(test.goos, func(t *testing.T) {
			options := windowOptionsForPlatform("workspace-7", nil, test.goos)

			require.Equal(t, test.wantHidden, options.Hidden)
		})
	}
}

func TestOptionsPreserveTheSharedPeerContract(t *testing.T) {
	nativeMenu := application.NewMenu()

	for _, goos := range []string{"darwin", "windows", "linux"} {
		t.Run(goos, func(t *testing.T) {
			options := windowOptionsForPlatform("workspace-7", nativeMenu, goos)

			require.Equal(t, "workspace-7", options.Name)
			require.Equal(t, "Luxury Yacht", options.Title)
			require.Equal(t, 1200, options.Width)
			require.Equal(t, 800, options.Height)
			require.Equal(t, 1100, options.MinWidth)
			require.Equal(t, 600, options.MinHeight)
			require.Zero(t, options.MaxWidth)
			require.Zero(t, options.MaxHeight)
			require.Equal(t, "/", options.URL)
			require.Equal(t, application.NewRGB(30, 30, 30), options.BackgroundColour)
			require.Equal(t, application.BackgroundTypeTransparent, options.BackgroundType)
			require.True(t, options.Mac.TitleBar.AppearsTransparent)
			require.True(t, options.Mac.TitleBar.FullSizeContent)
			require.True(t, options.Mac.TitleBar.HideTitle)
			require.True(t, options.Mac.TitleBar.HideToolbarSeparator)
			require.Equal(t, application.SystemDefault, options.Windows.Theme)
			require.Same(t, nativeMenu, options.Linux.Menu)
			require.True(t, options.UseApplicationMenu)
			require.Equal(t, 1.0, options.Zoom)
			require.False(t, options.ZoomControlEnabled)
			require.Equal(t, goos != "linux", options.Hidden)
		})
	}
}

func TestRegistryCreatesPeersFromTheMostRecentWindowGeometry(t *testing.T) {
	lifecycle := newLifecycle()
	sourceName := lifecycle.Add()
	sourceScreen := &application.Screen{
		ID:       "secondary",
		WorkArea: application.Rect{X: 1920, Y: 0, Width: 1920, Height: 1040},
	}
	var createdOptions application.WebviewWindowOptions
	registry := &Registry{
		lifecycle: lifecycle,
		newWindow: func(options application.WebviewWindowOptions) *application.WebviewWindow {
			createdOptions = options
			return application.NewWindow(options)
		},
		windowGeometry: func(name string) (geometry, bool) {
			require.Equal(t, sourceName, name)
			return geometry{
				X:         140,
				Y:         90,
				Width:     1440,
				Height:    900,
				Maximised: true,
				Screen:    sourceScreen,
			}, true
		},
	}

	created := registry.Create(false)

	require.Equal(t, "workspace-2", created.Name())
	require.Equal(t, 1440, createdOptions.Width)
	require.Equal(t, 900, createdOptions.Height)
	require.Equal(t, application.WindowXY, createdOptions.InitialPosition)
	require.Equal(t, 164, createdOptions.X)
	require.Equal(t, 114, createdOptions.Y)
	require.Same(t, sourceScreen, createdOptions.Screen)
	require.Equal(t, application.WindowStateMaximised, createdOptions.StartState)
}

func TestRegistryKeepsCascadedPeersOnTheSourceScreen(t *testing.T) {
	lifecycle := newLifecycle()
	lifecycle.Add()
	sourceScreen := &application.Screen{
		ID:       "primary",
		WorkArea: application.Rect{Width: 1200, Height: 800},
	}
	var createdOptions application.WebviewWindowOptions
	registry := &Registry{
		lifecycle: lifecycle,
		newWindow: func(options application.WebviewWindowOptions) *application.WebviewWindow {
			createdOptions = options
			return application.NewWindow(options)
		},
		windowGeometry: func(string) (geometry, bool) {
			return geometry{
				X:      80,
				Y:      100,
				Width:  1100,
				Height: 600,
				Screen: sourceScreen,
			}, true
		},
	}

	registry.Create(false)

	require.Equal(t, 56, createdOptions.X)
	require.Equal(t, 124, createdOptions.Y)
}

func TestPeerOptionsInheritSizeWithoutPositionWhenTheSourceScreenIsUnavailable(t *testing.T) {
	registry := &Registry{
		windowGeometry: func(string) (geometry, bool) {
			return geometry{Width: 1400, Height: 900}, true
		},
	}

	options := registry.optionsForPeer("workspace-2", "workspace-1", false)

	require.Equal(t, 1400, options.Width)
	require.Equal(t, 900, options.Height)
	require.Zero(t, options.InitialPosition)
	require.Nil(t, options.Screen)
	require.Zero(t, options.StartState)
}

func TestRegistryCreatesAndCountsPeersThroughTheWailsWindowManager(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)

	require.Zero(t, registry.Count())
	first := registry.Create(true)
	second := registry.Create(false)

	require.Equal(t, "workspace-1", first.Name())
	require.Equal(t, "workspace-2", second.Name())
	require.Equal(t, 2, registry.Count())
}

func TestPrepareApplicationQuitAllowsAnUnconfiguredRegistry(t *testing.T) {
	var missing *Registry

	require.True(t, missing.PrepareApplicationQuit())
	require.True(t, (&Registry{}).PrepareApplicationQuit())
}

func TestFocusMostRecentIgnoresAnEmptyRegistry(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil, nil)

	registry.FocusMostRecent()
}

func TestCascadedCoordinateKeepsWindowsInsideTheWorkArea(t *testing.T) {
	tests := []struct {
		name     string
		position int
		size     int
		limit    int
		want     int
	}{
		{name: "cascades forward", position: 10, size: 50, limit: 100, want: 34},
		{name: "reverses near the far edge", position: 50, size: 50, limit: 100, want: 26},
		{name: "clamps a negative position", position: -50, size: 100, limit: 120, want: 0},
		{name: "clamps beyond the far edge", position: 200, size: 50, limit: 100, want: 50},
		{name: "keeps position when neither offset fits", position: 10, size: 80, limit: 100, want: 10},
		{name: "clamps a window larger than the work area", position: 10, size: 120, limit: 100, want: 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, cascadedCoordinate(test.position, test.size, test.limit))
		})
	}
}
