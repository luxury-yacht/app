package appwindow

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type namedWorkspaceCapture struct {
	id      string
	waiting map[string]bool
	replies chan namedWorkspaceCaptureReply
}

type namedWorkspaceCaptureReply struct {
	window string
	state  panelwindow.NamedWorkspaceAppWindow
}

func (r *Registry) CaptureNamedWorkspace(ctx context.Context, source string) (panelwindow.NamedWorkspace, error) {
	if !r.namedWorkspaceOperation.TryLock() {
		return panelwindow.NamedWorkspace{}, fmt.Errorf("another workspace operation is in progress")
	}
	defer r.namedWorkspaceOperation.Unlock()
	if !r.isWorkspaceReady(source) {
		return panelwindow.NamedWorkspace{}, fmt.Errorf("source window is still opening")
	}
	apps, panels := r.lifecycle.Names(), r.panels.Names("")
	participants := append(slices.Clone(apps), panels...)
	if !slices.Equal(participants, r.readyWorkspaceNames()) {
		return panelwindow.NamedWorkspace{}, fmt.Errorf("wait for all windows to finish opening or moving before saving")
	}
	if _, err := r.workspace.WorkspaceCaptureRevision(); err != nil {
		return panelwindow.NamedWorkspace{}, err
	}
	capture, err := r.beginNamedWorkspaceCapture(participants)
	if err != nil {
		return panelwindow.NamedWorkspace{}, err
	}
	defer r.endNamedWorkspaceCapture()
	deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	states, err := r.requestNamedWorkspaceCapture(deadline, capture, participants)
	if err != nil {
		return panelwindow.NamedWorkspace{}, err
	}
	return r.assembleNamedWorkspace(apps, panels, states)
}

func (r *Registry) beginNamedWorkspaceCapture(windows []string) (*namedWorkspaceCapture, error) {
	r.workspaceCaptureMu.Lock()
	defer r.workspaceCaptureMu.Unlock()
	if r.workspaceCapture != nil {
		return nil, fmt.Errorf("a workspace capture is already in progress")
	}
	capture := &namedWorkspaceCapture{id: uuid.NewString(), waiting: make(map[string]bool), replies: make(chan namedWorkspaceCaptureReply, len(windows))}
	for _, window := range windows {
		capture.waiting[window] = true
	}
	r.workspaceCapture = capture
	return capture, nil
}

func (r *Registry) endNamedWorkspaceCapture() {
	r.workspaceCaptureMu.Lock()
	defer r.workspaceCaptureMu.Unlock()
	r.workspaceCapture = nil
}

func (r *Registry) requestNamedWorkspaceCapture(ctx context.Context, capture *namedWorkspaceCapture, windows []string) (map[string]panelwindow.NamedWorkspaceAppWindow, error) {
	for _, window := range windows {
		request := panelwindow.NamedWorkspaceCaptureRequest{ID: capture.id, WindowName: window}
		if !r.emitWindowEvent(window, panelwindow.NamedWorkspaceCaptureRequested, request) {
			return nil, fmt.Errorf("could not capture window %q", window)
		}
	}
	states := make(map[string]panelwindow.NamedWorkspaceAppWindow, len(windows))
	for range windows {
		select {
		case reply := <-capture.replies:
			states[reply.window] = reply.state
		case <-ctx.Done():
			return nil, fmt.Errorf("waiting for windows to capture workspace: %w", ctx.Err())
		}
	}
	return states, nil
}

func (r *Registry) SubmitNamedWorkspaceCapture(window, id string, state panelwindow.NamedWorkspaceAppWindow) error {
	r.workspaceCaptureMu.Lock()
	defer r.workspaceCaptureMu.Unlock()
	capture := r.workspaceCapture
	if capture == nil || capture.id != id || !capture.waiting[window] {
		return fmt.Errorf("window %q has no matching capture request", window)
	}
	delete(capture.waiting, window)
	capture.replies <- namedWorkspaceCaptureReply{window: window, state: state}
	return nil
}

func (r *Registry) assembleNamedWorkspace(apps, panels []string, states map[string]panelwindow.NamedWorkspaceAppWindow) (panelwindow.NamedWorkspace, error) {
	revision, err := r.workspace.WorkspaceCaptureRevision()
	if err != nil {
		return panelwindow.NamedWorkspace{}, err
	}
	workspace, err := r.readNamedWorkspaceWindows(apps, panels, states)
	if err != nil {
		return panelwindow.NamedWorkspace{}, err
	}
	if !slices.Equal(apps, r.lifecycle.Names()) || !slices.Equal(panels, r.panels.Names("")) {
		return panelwindow.NamedWorkspace{}, fmt.Errorf("windows changed during workspace capture")
	}
	finalRevision, err := r.workspace.WorkspaceCaptureRevision()
	if err != nil {
		return panelwindow.NamedWorkspace{}, err
	}
	if revision != finalRevision {
		return panelwindow.NamedWorkspace{}, fmt.Errorf("panels changed during workspace capture")
	}
	return workspace, nil
}

func (r *Registry) readNamedWorkspaceWindows(apps, panels []string, states map[string]panelwindow.NamedWorkspaceAppWindow) (panelwindow.NamedWorkspace, error) {
	workspace := panelwindow.NamedWorkspace{SchemaVersion: panelwindow.NamedWorkspaceSchemaVersion}
	for _, name := range apps {
		state := states[name]
		geometry, err := r.namedWorkspaceGeometry(name)
		if err != nil {
			return panelwindow.NamedWorkspace{}, err
		}
		state.Geometry = geometry
		if err := r.checkNamedWorkspaceAppWindow(name, state); err != nil {
			return panelwindow.NamedWorkspace{}, err
		}
		workspace.AppWindows = append(workspace.AppWindows, state)
	}
	for _, name := range panels {
		window, err := r.captureNamedPanelWindow(name)
		if err != nil {
			return panelwindow.NamedWorkspace{}, err
		}
		workspace.PanelWindows = append(workspace.PanelWindows, window)
	}
	return workspace, nil
}

func (r *Registry) checkNamedWorkspaceAppWindow(name string, state panelwindow.NamedWorkspaceAppWindow) error {
	clusters := r.backend.WindowClusterIDs(name)
	saved := make([]string, 0, len(state.ClusterTabs))
	for _, tab := range state.ClusterTabs {
		saved = append(saved, tab.ClusterID)
	}
	if !slices.Equal(slices.Sorted(slices.Values(clusters)), slices.Sorted(slices.Values(saved))) {
		return fmt.Errorf("cluster tabs changed in window %q during capture", name)
	}
	for _, clusterID := range clusters {
		if !sameNamedWorkspaceDockedGroups(clusterID, state.DockedGroups, r.workspace.DockedGroups(clusterID, name)) {
			return fmt.Errorf("docked panels changed in window %q during capture", name)
		}
	}
	return nil
}

func sameNamedWorkspaceDockedGroups(clusterID string, captured []panelwindow.NamedWorkspaceDockedGroup, groups []panelwindow.WorkspaceGroup) bool {
	count := 0
	for _, dock := range captured {
		if dock.Group.ClusterID != clusterID {
			continue
		}
		count++
		if !slices.ContainsFunc(groups, func(group panelwindow.WorkspaceGroup) bool {
			return dock.Group.GroupID == group.GroupID && dock.Group.ActivePanelID == group.ActivePanelID && slices.Equal(dock.Group.Tabs, group.Tabs)
		}) {
			return false
		}
	}
	return count == len(groups)
}

func (r *Registry) captureNamedPanelWindow(name string) (panelwindow.NamedWorkspacePanelWindow, error) {
	descriptor, err := r.PanelDescriptor(name)
	if err != nil || descriptor.State != PanelWindowStateLive {
		return panelwindow.NamedWorkspacePanelWindow{}, fmt.Errorf("panel window %q changed during capture", name)
	}
	geometry, err := r.namedWorkspaceGeometry(name)
	if err != nil {
		return panelwindow.NamedWorkspacePanelWindow{}, err
	}
	return panelwindow.NamedWorkspacePanelWindow{Geometry: geometry, Group: descriptor.Group}, nil
}

func (r *Registry) namedWorkspaceGeometry(name string) (panelwindow.NamedWorkspaceGeometry, error) {
	bounds, ok := r.windowGeometry(name)
	if !ok {
		return panelwindow.NamedWorkspaceGeometry{}, fmt.Errorf("window %q has no usable geometry", name)
	}
	normal := panelwindow.WindowBounds{X: bounds.AbsoluteX, Y: bounds.AbsoluteY, Width: bounds.Width, Height: bounds.Height}
	if bounds.Maximised {
		if previous, found := r.normalWorkspaceBounds.Load(name); found {
			normal = previous.(panelwindow.WindowBounds)
		}
	}
	return panelwindow.NamedWorkspaceGeometry{
		WindowBounds: normal,
		Maximized:    bounds.Maximised,
	}, nil
}

func (r *Registry) trackNamedWorkspaceBounds(window *application.WebviewWindow, name string) {
	record := func(*application.WindowEvent) { r.rememberNamedWorkspaceBounds(window, name) }
	window.OnWindowEvent(events.Common.WindowDidMove, record)
	window.OnWindowEvent(events.Common.WindowDidResize, record)
}

func (r *Registry) rememberNamedWorkspaceBounds(window application.Window, name string) {
	if window.IsMaximised() || window.IsFullscreen() || window.IsMinimised() {
		return
	}
	width, height := window.Size()
	if width <= 0 || height <= 0 {
		return
	}
	x, y := window.Position()
	r.normalWorkspaceBounds.Store(name, panelwindow.WindowBounds{X: x, Y: y, Width: width, Height: height})
}
