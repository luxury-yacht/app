package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	testCompositionOnce sync.Once
	testComposition     *applicationComposition
)

func sharedTestComposition() *applicationComposition {
	testCompositionOnce.Do(func() {
		testComposition = newApplicationComposition(&mainRecordingReporter{}, compositionOptions{SingleInstance: true})
	})
	return testComposition
}

type mainRecordingReporter struct {
	panics     []any
	exceptions []error
}

func (*mainRecordingReporter) Enabled() bool                                   { return true }
func (*mainRecordingReporter) SetEnabled(bool) error                           { return nil }
func (*mainRecordingReporter) CaptureLogError(string, sentryreporting.Context) {}
func (*mainRecordingReporter) AddBreadcrumb(sentryreporting.Breadcrumb)        {}
func (*mainRecordingReporter) Shutdown(time.Duration) bool                     { return true }

func (r *mainRecordingReporter) CaptureException(err error, _ sentryreporting.Context) {
	r.exceptions = append(r.exceptions, err)
}

func (r *mainRecordingReporter) CapturePanic(recovered any, _ sentryreporting.Context) {
	r.panics = append(r.panics, recovered)
}

func TestReportPanicCapturesAndRethrows(t *testing.T) {
	reporter := &mainRecordingReporter{}

	func() {
		defer func() {
			require.Equal(t, "boom", recover())
		}()
		func() {
			defer reportPanic(reporter)
			panic("boom")
		}()
	}()

	require.Equal(t, []any{"boom"}, reporter.panics)
}

func TestReportRunErrorCapturesOnlyFailures(t *testing.T) {
	reporter := &mainRecordingReporter{}
	failure := errors.New("webview failed")

	reportRunError(reporter, nil)
	reportRunError(reporter, failure)

	require.Equal(t, []error{failure}, reporter.exceptions)
}

func TestDefaultSentryReleaseUsesVersionedBuildIdentity(t *testing.T) {
	require.Equal(t, "luxury-yacht@v1.2.3", defaultSentryRelease(" v1.2.3 "))
	require.Empty(t, defaultSentryRelease("dev"))
}

func TestNewSentryReporterStaysDisabledWhenBuildDisablesReporting(t *testing.T) {
	t.Setenv("SENTRY_BACKEND_DSN", "https://runtime@example.com/2")

	reporter, err := newSentryReporter(false, "https://embedded@example.com/1", "v1.2.3")

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestNewSentryReporterStartsDisabledUntilPersistedPreferenceLoads(t *testing.T) {
	reporter, err := newSentryReporter(true, "https://embedded@example.com/1", "v1.2.3")

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestApplicationCompositionOwnsPeerWindowRegistryMenuAndService(t *testing.T) {
	composition := sharedTestComposition()

	require.NotNil(t, composition.application)
	require.NotNil(t, composition.backend)
	require.NotNil(t, composition.menu)
	require.Equal(t, composition.menu, composition.application.Menu.GetApplicationMenu())

	window, ok := composition.application.Window.GetByName("workspace-1")
	require.True(t, ok)
	require.NotNil(t, composition.windows)
	require.Equal(t, "workspace-1", window.Name())
	require.Equal(t, 1, composition.windows.lifecycle.Count())
	config := composition.application.Config()
	require.Len(t, config.Services, 1)
	require.NotNil(t, config.Assets.Handler)
	require.NotNil(t, config.ShouldQuit)
	require.NotNil(t, config.SingleInstance)
	require.Equal(t, applicationProductIdentifier, config.SingleInstance.UniqueID)
	require.NotNil(t, config.SingleInstance.OnSecondInstanceLaunch)
}

func TestWorkspaceWindowVisibilityPreservesPlatformStartupContract(t *testing.T) {
	for _, test := range []struct {
		goos       string
		wantHidden bool
	}{
		{goos: "darwin", wantHidden: true},
		{goos: "windows", wantHidden: true},
		{goos: "linux", wantHidden: false},
	} {
		t.Run(test.goos, func(t *testing.T) {
			options := workspaceWindowOptionsForPlatform("workspace-7", nil, test.goos)

			require.Equal(t, test.wantHidden, options.Hidden)
		})
	}
}

func TestWorkspaceWindowOptionsPreserveTheSharedPeerContract(t *testing.T) {
	nativeMenu := application.NewMenu()

	for _, goos := range []string{"darwin", "windows", "linux"} {
		t.Run(goos, func(t *testing.T) {
			options := workspaceWindowOptionsForPlatform("workspace-7", nativeMenu, goos)

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

func TestWorkspaceWindowRegistryCreatesPeersFromTheMostRecentWindowGeometry(t *testing.T) {
	lifecycle := newWorkspaceWindowLifecycle()
	sourceName := lifecycle.Add()
	sourceScreen := &application.Screen{
		ID:       "secondary",
		WorkArea: application.Rect{X: 1920, Y: 0, Width: 1920, Height: 1040},
	}
	var createdOptions application.WebviewWindowOptions
	registry := &workspaceWindowRegistry{
		lifecycle: lifecycle,
		newWindow: func(options application.WebviewWindowOptions) *application.WebviewWindow {
			createdOptions = options
			return application.NewWindow(options)
		},
		windowGeometry: func(name string) (workspaceWindowGeometry, bool) {
			require.Equal(t, sourceName, name)
			return workspaceWindowGeometry{
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

func TestWorkspaceWindowRegistryKeepsCascadedPeersOnTheSourceScreen(t *testing.T) {
	lifecycle := newWorkspaceWindowLifecycle()
	lifecycle.Add()
	sourceScreen := &application.Screen{
		ID:       "primary",
		WorkArea: application.Rect{Width: 1200, Height: 800},
	}
	var createdOptions application.WebviewWindowOptions
	registry := &workspaceWindowRegistry{
		lifecycle: lifecycle,
		newWindow: func(options application.WebviewWindowOptions) *application.WebviewWindow {
			createdOptions = options
			return application.NewWindow(options)
		},
		windowGeometry: func(string) (workspaceWindowGeometry, bool) {
			return workspaceWindowGeometry{
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

type startupFailureProbeService struct {
	name               string
	startupErr         error
	context            context.Context
	shutdownContextErr error
	sequence           *[]string
}

func (s *startupFailureProbeService) ServiceName() string { return s.name }

func (s *startupFailureProbeService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.context = ctx
	*s.sequence = append(*s.sequence, "start:"+s.name)
	return s.startupErr
}

func (s *startupFailureProbeService) ServiceShutdown() error {
	s.shutdownContextErr = s.context.Err()
	*s.sequence = append(*s.sequence, "stop:"+s.name)
	return nil
}

func TestApplicationRunRollsBackStartedServicesAfterStartupFailure(t *testing.T) {
	const helperEnv = "LUXURY_YACHT_TEST_STARTUP_FAILURE"
	if os.Getenv(helperEnv) != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestApplicationRunRollsBackStartedServicesAfterStartupFailure$")
		command.Env = append(os.Environ(), helperEnv+"=1")
		output, err := command.CombinedOutput()
		require.NoError(t, err, string(output))
		return
	}

	sequence := []string{}
	started := &startupFailureProbeService{name: "started", sequence: &sequence}
	failure := errors.New("startup failed")
	failing := &startupFailureProbeService{name: "failing", startupErr: failure, sequence: &sequence}
	wailsApp := application.New(application.Options{ErrorHandler: func(error) {}})
	wailsApp.RegisterService(application.NewService(started))
	wailsApp.RegisterService(application.NewService(failing))

	err := wailsApp.Run()

	require.ErrorIs(t, err, failure)
	require.Equal(t, []string{"start:started", "start:failing", "stop:started"}, sequence)
	require.ErrorIs(t, started.shutdownContextErr, context.Canceled)
}
