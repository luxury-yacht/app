package backend

import (
	"context"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (s *DesktopService) SaveNamedWorkspace(ctx context.Context, window, name string, replace bool, revision string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.SaveNamedWorkspace(ctx, window, name, replace, revision)
}

// SubmitNamedWorkspaceCapture is a window's reply to a capture request: its view,
// or the reason it could not report one.
func (s *DesktopService) SubmitNamedWorkspaceCapture(ctx context.Context, window, id string, view panelwindow.NamedWorkspaceAppView, failure string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.SubmitNamedWorkspaceCapture(window, id, view, failure)
}

func (s *DesktopService) ListNamedWorkspaces() ([]panelwindow.NamedWorkspaceEntry, error) {
	return s.namedWorkspaces.ListNamedWorkspaces()
}

func (s *DesktopService) DeleteNamedWorkspace(ctx context.Context, window, name, revision string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.DeleteNamedWorkspace(name, revision)
}

func (s *DesktopService) RenameNamedWorkspace(ctx context.Context, window, name, newName, revision string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.RenameNamedWorkspace(name, newName, revision)
}

func (s *DesktopService) OpenNamedWorkspace(ctx context.Context, window, name, revision string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.OpenNamedWorkspace(ctx, window, name, revision)
}

func (s *DesktopService) AcknowledgeNamedWorkspaceRestore(ctx context.Context, window, failure string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.AcknowledgeNamedWorkspaceRestore(window, failure)
}
