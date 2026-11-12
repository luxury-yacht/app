package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

type NamedWorkspaceCaptureCommands interface {
	OpenNamedWorkspace(context.Context, string, panelwindow.NamedWorkspace) error
	AcknowledgeNamedWorkspaceRestore(string, string) error
	CaptureNamedWorkspace(context.Context, string) (panelwindow.NamedWorkspace, error)
	SubmitNamedWorkspaceCapture(string, string, panelwindow.NamedWorkspaceAppView, string) error
}

type NamedWorkspaceStore interface {
	GetNamedWorkspace(string) (*NamedWorkspace, error)
	SaveNamedWorkspace(string, NamedWorkspace, bool) error
	ListNamedWorkspaces() ([]string, error)
	DeleteNamedWorkspace(string) error
	RenameNamedWorkspace(string, string) error
}

type NamedWorkspaceService struct {
	windows NamedWorkspaceCaptureCommands
	store   NamedWorkspaceStore
}

func NewNamedWorkspaceService(windows NamedWorkspaceCaptureCommands, store NamedWorkspaceStore) *NamedWorkspaceService {
	return &NamedWorkspaceService{windows: windows, store: store}
}

func (s *NamedWorkspaceService) SaveNamedWorkspace(ctx context.Context, window, name string, replace bool) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("workspace name is required")
	}
	workspace, err := s.windows.CaptureNamedWorkspace(ctx, window)
	if err != nil {
		return err
	}
	return s.store.SaveNamedWorkspace(name, workspace, replace)
}

func (s *NamedWorkspaceService) ListNamedWorkspaces() ([]string, error) {
	return s.store.ListNamedWorkspaces()
}

func (s *NamedWorkspaceService) DeleteNamedWorkspace(name string) error {
	return s.store.DeleteNamedWorkspace(name)
}

func (s *NamedWorkspaceService) RenameNamedWorkspace(name, newName string) error {
	return s.store.RenameNamedWorkspace(name, newName)
}

func (s *NamedWorkspaceService) SubmitNamedWorkspaceCapture(window, id string, view panelwindow.NamedWorkspaceAppView, failure string) error {
	return s.windows.SubmitNamedWorkspaceCapture(window, id, view, failure)
}

func (s *NamedWorkspaceService) OpenNamedWorkspace(ctx context.Context, window, name string) error {
	snapshot, err := s.store.GetNamedWorkspace(name)
	if err != nil {
		return err
	}
	return s.windows.OpenNamedWorkspace(ctx, window, *snapshot)
}

func (s *NamedWorkspaceService) AcknowledgeNamedWorkspaceRestore(window, failure string) error {
	return s.windows.AcknowledgeNamedWorkspaceRestore(window, failure)
}
