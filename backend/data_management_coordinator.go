package backend

import (
	"context"
	"errors"
	"fmt"
)

type DataManagementDependencies struct {
	Preferences        *PreferencesService
	Favorites          *FavoritesService
	UIState            *UIStateStore
	Updates            *UpdateCoordinator
	Attention          *ClusterAttentionService
	ErrorReporting     *ErrorReportingService
	AppLogs            *AppLogService
	DesktopShell       *DesktopShell
	RuntimeAvailable   func() bool
	Context            func() context.Context
	WorkspaceMutation  func(string, func() error) error
	ResetRuntime       func() error
	SearchPathsChanged func()
}

// DataManagementCoordinator owns portable-state import/export and total live
// reset orchestration. Collaborators are concrete leaf owners or narrow
// functions; it never retains an App back-pointer.
type DataManagementCoordinator struct {
	preferences        *PreferencesService
	favorites          *FavoritesService
	uiState            *UIStateStore
	updates            *UpdateCoordinator
	attention          *ClusterAttentionService
	errorReporting     *ErrorReportingService
	appLogs            *AppLogService
	desktopShell       *DesktopShell
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
	reset := func() error {
		var failures []error
		if c.workspaceMutation != nil && c.resetRuntime != nil {
			failures = append(failures, c.workspaceMutation("clear-app-state", c.resetRuntime))
		} else if c.resetRuntime != nil {
			failures = append(failures, c.resetRuntime())
		}
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
		if c.searchPathsChanged != nil {
			failures = append(failures, c.runWorkspaceMutation("reset-kubeconfig-search-paths", func() error {
				c.searchPathsChanged()
				return nil
			}))
		}
		if c.attention != nil {
			c.attention.ResetProjection()
		}
		if c.desktopShell != nil {
			c.desktopShell.ResetProcessState()
		}
		if c.preferences != nil {
			c.preferences.DispatchDefaults()
		}
		if c.appLogs != nil {
			failures = append(failures, c.appLogs.ClearAppLogs())
		}
		failures = compactErrors(failures)
		if len(failures) > 0 {
			return fmt.Errorf("clear app state: %w", errors.Join(failures...))
		}
		return nil
	}
	if c.errorReporting != nil {
		return c.errorReporting.WithInstallationTelemetryQuiesced(reset)
	}
	return reset()
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
