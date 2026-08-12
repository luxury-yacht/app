package main

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"gopkg.in/yaml.v3"
)

func TestSecondLaunchCoordinatorQueuesUntilWindowRuntimeReady(t *testing.T) {
	coordinator := &secondLaunchCoordinator{}
	focusCalls := 0

	coordinator.Request()
	require.Zero(t, focusCalls)

	coordinator.Bind(func() { focusCalls++ })
	require.Equal(t, 1, focusCalls)

	coordinator.Request()
	require.Equal(t, 2, focusCalls)
}

func TestSingleInstanceIdentifierMatchesBuildMetadata(t *testing.T) {
	contents, err := os.ReadFile("build/config.yml")
	require.NoError(t, err)
	var config struct {
		Info struct {
			ProductIdentifier string `yaml:"productIdentifier"`
		} `yaml:"info"`
	}
	require.NoError(t, yaml.Unmarshal(contents, &config))
	require.Equal(t, config.Info.ProductIdentifier, applicationProductIdentifier)
}

func TestSecondLaunchCoordinatorDoesNotResurrectWindowDuringShutdown(t *testing.T) {
	coordinator := &secondLaunchCoordinator{}
	focusCalls := 0

	coordinator.Request()
	coordinator.Stop()
	coordinator.Bind(func() { focusCalls++ })
	coordinator.Request()

	require.Zero(t, focusCalls)
}

func TestSecondLaunchCoordinatorDropsDispatchedFocusWhenShutdownWins(t *testing.T) {
	var scheduled []func()
	coordinator := newSecondLaunchCoordinator(func(callback func()) {
		scheduled = append(scheduled, callback)
	})
	focusCalls := 0
	coordinator.Bind(func() { focusCalls++ })

	coordinator.Request()
	require.Len(t, scheduled, 1)
	coordinator.Stop()
	scheduled[0]()

	require.Zero(t, focusCalls)
}

func TestSingleInstanceOptionsIgnoreUntrustedLaunchData(t *testing.T) {
	coordinator := &secondLaunchCoordinator{}
	focusCalls := 0
	coordinator.Bind(func() { focusCalls++ })

	options := newSingleInstanceOptions(coordinator)
	require.Equal(t, applicationProductIdentifier, options.UniqueID)
	require.Empty(t, options.AdditionalData)
	require.Zero(t, options.EncryptionKey)

	options.OnSecondInstanceLaunch(application.SecondInstanceData{
		Args:           []string{"luxury-yacht", "--untrusted"},
		WorkingDir:     "/untrusted",
		AdditionalData: map[string]string{"untrusted": "value"},
	})
	require.Equal(t, 1, focusCalls)
}
