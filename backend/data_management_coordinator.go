package backend

import (
	"context"
	"errors"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type dataManagementPreferences interface {
	DispatchDefaults()
	Reset() error
	exportSettingsDocument() (*settingsFile, error)
	importSettingsDocument(*settingsDataFile, settingsSideEffects) error
}

type dataManagementFavorites interface {
	Reset() error
	exportSnapshot() ([]Favorite, error)
	importSnapshot([]Favorite) error
}

type dataManagementResetter interface {
	Reset() error
}

type contextResetter interface {
	Reset(context.Context) error
}

type projectionResetter interface {
	ResetProjection()
}

type installationTelemetryQuiescer interface {
	WithInstallationTelemetryQuiesced(func() error) error
}

type appLogsClearer interface {
	ClearAppLogs() error
}

type dataManagementDesktopShell interface {
	ResetProcessState()
	promptForOpenFile(*application.OpenFileDialogOptions) (string, error)
	promptForSaveFile(*application.SaveFileDialogOptions) (string, error)
}

type DataManagementDependencies struct {
	Preferences        dataManagementPreferences
	Favorites          dataManagementFavorites
	UIState            dataManagementResetter
	Updates            contextResetter
	Attention          projectionResetter
	ErrorReporting     installationTelemetryQuiescer
	AppLogs            appLogsClearer
	DesktopShell       dataManagementDesktopShell
	RuntimeAvailable   func() bool
	Context            func() context.Context
	WorkspaceMutation  func(string, func() error) error
	ResetRuntime       func() error
	SearchPathsChanged func()
}

// DataManagementCoordinator owns portable-state import/export and total live
// reset orchestration. Collaborators are concrete leaf owners or narrow
// functions; it never retains the application composition root.
type DataManagementCoordinator struct {
	preferences        dataManagementPreferences
	favorites          dataManagementFavorites
	uiState            dataManagementResetter
	updates            contextResetter
	attention          projectionResetter
	errorReporting     installationTelemetryQuiescer
	appLogs            appLogsClearer
	desktopShell       dataManagementDesktopShell
	runtimeAvailable   func() bool
	context            func() context.Context
	workspaceMutation  func(string, func() error) error
	resetRuntime       func() error
	searchPathsChanged func()
}

func NewDataManagementCoordinator(dependencies DataManagementDependencies) *DataManagementCoordinator {
	return &DataManagementCoordinator{
		preferences: dependencies.Preferences, favorites: dependencies.Favorites,
		uiState: dependencies.UIState, updates: dependencies.Updates,
		attention: dependencies.Attention, errorReporting: dependencies.ErrorReporting,
		appLogs: dependencies.AppLogs, desktopShell: dependencies.DesktopShell,
		runtimeAvailable: dependencies.RuntimeAvailable, context: dependencies.Context,
		workspaceMutation: dependencies.WorkspaceMutation, resetRuntime: dependencies.ResetRuntime,
		searchPathsChanged: dependencies.SearchPathsChanged,
	}
}

func (c *DataManagementCoordinator) ClearAppState() error {
	if err := c.requireDataManagementContext(); err != nil {
		return err
	}
	if c.errorReporting != nil {
		return c.errorReporting.WithInstallationTelemetryQuiesced(c.clearAppState)
	}
	return c.clearAppState()
}

func (c *DataManagementCoordinator) clearAppState() error {
	failures := c.resetStoredOwners()
	failures = append(failures, c.resetKubeconfigSearchPaths())
	c.resetRuntimeProjections()
	if c.appLogs != nil {
		failures = append(failures, c.appLogs.ClearAppLogs())
	}
	failures = compactErrors(failures)
	if len(failures) > 0 {
		return fmt.Errorf("clear app state: %w", errors.Join(failures...))
	}
	return nil
}

func (c *DataManagementCoordinator) resetStoredOwners() []error {
	failures := []error{c.resetClusterRuntime()}
	ctx := context.Background()
	if c.context != nil {
		ctx = c.context()
	}
	if c.updates != nil {
		failures = append(failures, c.updates.Reset(ctx))
	}
	if c.favorites != nil {
		failures = append(failures, c.favorites.Reset())
	}
	if c.uiState != nil {
		failures = append(failures, c.uiState.Reset())
	}
	if c.preferences != nil {
		failures = append(failures, c.preferences.Reset())
	}
	return failures
}

func (c *DataManagementCoordinator) resetClusterRuntime() error {
	if c.resetRuntime == nil {
		return nil
	}
	if c.workspaceMutation != nil {
		return c.workspaceMutation("clear-app-state", c.resetRuntime)
	}
	return c.resetRuntime()
}

func (c *DataManagementCoordinator) resetKubeconfigSearchPaths() error {
	if c.searchPathsChanged == nil {
		return nil
	}
	return c.runWorkspaceMutation("reset-kubeconfig-search-paths", func() error {
		c.searchPathsChanged()
		return nil
	})
}

func (c *DataManagementCoordinator) resetRuntimeProjections() {
	if c.attention != nil {
		c.attention.ResetProjection()
	}
	if c.desktopShell != nil {
		c.desktopShell.ResetProcessState()
	}
	if c.preferences != nil {
		c.preferences.DispatchDefaults()
	}
}

func compactErrors(values []error) []error {
	result := values[:0]
	for _, err := range values {
		if err != nil {
			result = append(result, err)
		}
	}
	return result
}

func (c *DataManagementCoordinator) requireDataManagementContext() error {
	if c == nil {
		return fmt.Errorf("data management coordinator is not initialised")
	}
	if c.runtimeAvailable == nil || !c.runtimeAvailable() {
		return fmt.Errorf("application context is not available")
	}
	return nil
}

func (c *DataManagementCoordinator) runWorkspaceMutation(name string, action func() error) error {
	if c.workspaceMutation == nil {
		return action()
	}
	return c.workspaceMutation(name, action)
}
