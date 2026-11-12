package backend

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (s *DesktopService) SaveNamedWorkspace(ctx context.Context, window, name string, replace bool) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	return s.namedWorkspaces.SaveNamedWorkspace(ctx, window, name, replace)
}

func (s *DesktopService) SubmitNamedWorkspaceCapture(ctx context.Context, window, id, payload string) error {
	if err := validatePanelCommandCaller(ctx, window); err != nil {
		return err
	}
	var state panelwindow.NamedWorkspaceAppWindow
	if err := json.Unmarshal([]byte(payload), &state); err != nil {
		return fmt.Errorf("invalid workspace capture: %w", err)
	}
	return s.namedWorkspaces.SubmitNamedWorkspaceCapture(window, id, state)
}

func (s *DesktopService) ListNamedWorkspaces() ([]string, error) {
	return s.namedWorkspaces.ListNamedWorkspaces()
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
