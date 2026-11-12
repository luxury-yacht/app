package backend

import (
	"context"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (s *DesktopService) SaveNamedWorkspace(ctx context.Context, window, name string, replace bool) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.SaveNamedWorkspace(ctx, window, name, replace)
}

// SubmitNamedWorkspaceCapture is a window's reply to a capture request: its view,
// or the reason it could not report one.
func (s *DesktopService) SubmitNamedWorkspaceCapture(ctx context.Context, window, id string, view panelwindow.NamedWorkspaceAppView, failure string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.SubmitNamedWorkspaceCapture(window, id, view, failure)
}

func (s *DesktopService) ListNamedWorkspaces() ([]string, error) {
	return s.namedWorkspaces.ListNamedWorkspaces()
}

func (s *DesktopService) DeleteNamedWorkspace(ctx context.Context, window, name string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.DeleteNamedWorkspace(name)
}

func (s *DesktopService) RenameNamedWorkspace(ctx context.Context, window, name, newName string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.RenameNamedWorkspace(name, newName)
}

func (s *DesktopService) OpenNamedWorkspace(ctx context.Context, window, name string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.OpenNamedWorkspace(ctx, window, name)
}

func (s *DesktopService) AcknowledgeNamedWorkspaceRestore(ctx context.Context, window, failure string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.AcknowledgeNamedWorkspaceRestore(window, failure)
}
