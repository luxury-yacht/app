package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	testCompositionOnce sync.Once
	testComposition     *applicationComposition
)

func sharedTestComposition(t *testing.T) *applicationComposition {
	testCompositionOnce.Do(func() {
		reporter, err := sentryreporting.New(sentryreporting.Config{})
		require.NoError(t, err)
		testComposition = newApplicationComposition(fstest.MapFS{"frontend/dist/index.html": {Data: []byte("bootstrap assets")}}, reporter, compositionOptions{
			SingleInstance:         true,
			SingleInstanceUniqueID: testSingleInstanceID(),
		})
	})
	return testComposition
}

func testSingleInstanceID() string {
	return fmt.Sprintf("%s.test.%d", applicationProductIdentifier, os.Getpid())
}

func TestNativeApplicationMenuIsInstalledOnlyOnDarwin(t *testing.T) {
	for _, test := range []struct {
		goos      string
		wantCalls int
	}{
		{goos: "darwin", wantCalls: 1},
		{goos: "windows"},
		{goos: "linux"},
	} {
		t.Run(test.goos, func(t *testing.T) {
			calls := 0
			installNativeApplicationMenuForPlatform(test.goos, func() { calls++ })

			require.Equal(t, test.wantCalls, calls)
		})
	}
}

func TestApplicationCompositionOwnsPeerWindowRegistryMenuAndService(t *testing.T) {
	composition := sharedTestComposition(t)

	require.NotNil(t, composition.application)
	require.NotNil(t, composition.backend)
	require.NotNil(t, composition.service)
	require.NotNil(t, composition.operations)
	require.NotNil(t, composition.menu)
	if runtime.GOOS == "darwin" {
		require.Equal(t, composition.menu, composition.application.Menu.GetApplicationMenu())
	} else {
		require.Nil(t, composition.application.Menu.GetApplicationMenu())
	}

	window, ok := composition.application.Window.GetByName("workspace-1")
	require.True(t, ok)
	require.NotNil(t, composition.windows)
	require.Equal(t, "workspace-1", window.Name())
	require.Equal(t, 1, composition.windows.Count())
	config := composition.application.Config()
	require.Len(t, config.Services, 1)
	require.NotNil(t, config.Assets.Handler)
	response := httptest.NewRecorder()
	config.Assets.Handler.ServeHTTP(response, httptest.NewRequest("GET", "/", nil))
	require.Equal(t, 200, response.Code)
	require.Equal(t, "bootstrap assets", response.Body.String())
	require.NotNil(t, config.ShouldQuit)
	require.NotNil(t, config.SingleInstance)
	require.Equal(t, testSingleInstanceID(), config.SingleInstance.UniqueID)
	require.NotNil(t, config.SingleInstance.OnSecondInstanceLaunch)
}

func TestSingleInstanceUniqueIDDefaultsToProductIdentifier(t *testing.T) {
	require.Equal(t, applicationProductIdentifier, singleInstanceUniqueID(""))
	require.Equal(t, applicationProductIdentifier, singleInstanceUniqueID(" \t"))
	require.Equal(t, "test-instance", singleInstanceUniqueID(" test-instance "))
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

func TestBootstrapRunRollsBackStartedServicesAfterStartupFailure(t *testing.T) {
	const helperEnv = "LUXURY_YACHT_TEST_STARTUP_FAILURE"
	if os.Getenv(helperEnv) != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestBootstrapRunRollsBackStartedServicesAfterStartupFailure$")
		command.Env = append(os.Environ(), helperEnv+"=1")
		output, err := command.CombinedOutput()
		require.NoError(t, err, string(output))
		return
	}

	stateRoot := t.TempDir()
	for _, key := range []string{"HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "APPDATA"} {
		t.Setenv(key, stateRoot)
	}

	sequence := []string{}
	started := &startupFailureProbeService{name: "started", sequence: &sequence}
	failure := errors.New("startup failed")
	failing := &startupFailureProbeService{name: "failing", startupErr: failure, sequence: &sequence}
	wailsApp := application.New(application.Options{ErrorHandler: func(error) {}})
	wailsApp.RegisterService(application.NewService(started))
	wailsApp.RegisterService(application.NewService(failing))

	Run(fstest.MapFS{"frontend/dist/index.html": {Data: []byte("bootstrap assets")}})
	require.Equal(t, []string{"start:started", "start:failing", "stop:started"}, sequence)
	require.ErrorIs(t, started.shutdownContextErr, context.Canceled)
}
