package backend

import (
	"context"

	"github.com/luxury-yacht/app/internal/updatestate"
)

// UpdateCoordinator owns the complete application-update lifecycle, including
// framework event subscriptions and shutdown.
type UpdateCoordinator struct {
	coordinator   applicationUpdateCoordinator
	unsubscribers []func()
	context       func() context.Context
	emit          func(string, ...interface{})
	logger        *Logger
	shell         *DesktopShell
	resetState    *updatestate.Store
	resetStateErr error
}

func NewUpdateCoordinator(
	shell *DesktopShell,
	contextProvider func() context.Context,
	emit func(string, ...interface{}),
	logger *Logger,
) *UpdateCoordinator {
	return &UpdateCoordinator{shell: shell, context: contextProvider, emit: emit, logger: logger}
}

func (u *UpdateCoordinator) RuntimeReady() {
	if u != nil && u.coordinator != nil {
		u.coordinator.RuntimeReady()
	}
}

func (u *UpdateCoordinator) Stop() {
	if u == nil {
		return
	}
	if u.coordinator != nil {
		u.coordinator.Stop()
	}
	for _, unsubscribe := range u.unsubscribers {
		if unsubscribe != nil {
			unsubscribe()
		}
	}
	u.unsubscribers = nil
}

func (u *UpdateCoordinator) Reset(ctx context.Context) error {
	if u == nil {
		return nil
	}
	if resetter, ok := u.coordinator.(interface {
		Reset(context.Context) error
	}); ok {
		if err := resetter.Reset(ctx); err != nil {
			return err
		}
	}
	if u.resetStateErr != nil {
		return u.resetStateErr
	}
	if u.resetState != nil {
		return u.resetState.Reset()
	}
	return nil
}

func (u *UpdateCoordinator) operationContext() context.Context {
	if u == nil || u.context == nil {
		return context.Background()
	}
	return u.context()
}
