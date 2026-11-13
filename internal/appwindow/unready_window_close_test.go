package appwindow

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// A window whose renderer cannot answer (its crash screen is showing, or its
// page is loading) has no close guard to run. Asking it would leave its close
// button dead, so it closes without being asked.
func TestAppWindowWhoseRendererCannotAnswerClosesWithoutBeingAsked(t *testing.T) {
	backend := &recordingLifecycleBackend{}
	registry := NewRegistry(application.New(application.Options{}), backend)
	staying, crashed := registry.Create(true).Name(), registry.Create(false).Name()
	readyAppWindow(registry, staying)
	readyAppWindow(registry, crashed)
	require.NoError(t, registry.WithdrawRendererReady(crashed))
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		if eventName == panelwindow.WorkspaceCloseRequestedEventName {
			t.Errorf("window %q was asked to run close guards it cannot run", target)
		}
		return true
	}
	event := application.NewWindowEvent()

	registry.handleClosing(event, crashed)

	require.False(t, event.IsCancelled())
	require.Equal(t, 1, registry.Count())
	require.Equal(t, crashed, backend.releasedWindow)
}

func TestPanelWindowWhoseRendererCannotAnswerClosesWithoutBeingAsked(t *testing.T) {
	snapshot := validPanelGroupSnapshot()
	registry, panel := liveNativeWindow(t, snapshot)
	registry.backend = &recordingLifecycleBackend{}
	require.NoError(t, registry.WithdrawRendererReady(panel))
	var closed []string
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }
	registry.emitWindowEvent = func(target, eventName string, _ any) bool {
		if eventName == panelwindow.WindowCloseRequestedEventName {
			t.Errorf("window %q was asked to run close guards it cannot run", target)
		}
		return true
	}

	registry.handlePanelClosingEvent(application.NewWindowEvent(), panel)

	require.Equal(t, []string{panel}, closed)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(panel))
	require.Empty(t, registry.workspace.Snapshot(snapshot.ClusterID).Panels)
}

func TestClusterCloseDoesNotAskAPanelWindowWhoseRendererCannotAnswer(t *testing.T) {
	registry, _, source, windows := clusterCloseFixture(t)
	require.NoError(t, registry.WithdrawRendererReady(windows[0]))
	var closed, asked []string
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }
	registry.emitWindowEvent = func(target, event string, payload any) bool {
		if event == panelwindow.ClusterPanelCloseRequestedEventName {
			asked = append(asked, target)
			request := payload.(panelwindow.ClusterPanelCloseEvent)
			go func() { _ = registry.AcknowledgeClusterPanelClose(target, request.TransactionID, true) }()
		}
		return true
	}

	allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")

	require.NoError(t, err)
	require.True(t, allowed)
	require.Equal(t, []string{windows[1]}, asked)
	require.ElementsMatch(t, windows[:2], closed, "the window that could not answer closes with its cluster")
}

// A panel window that stops being able to answer after it was asked ends the
// cluster close at once instead of at its timeout.
func TestClusterCloseEndsWhenAnAskedPanelWindowCanNoLongerAnswer(t *testing.T) {
	registry, _, source, windows := clusterCloseFixture(t)
	registry.closeWindow = func(name string) bool {
		t.Errorf("window %q closed although the cluster close was cancelled", name)
		return true
	}
	registry.emitWindowEvent = func(target, event string, _ any) bool {
		if event == panelwindow.ClusterPanelCloseRequestedEventName && target == windows[0] {
			go func() { _ = registry.WithdrawRendererReady(target) }()
		}
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	allowed, err := registry.CloseClusterView(ctx, source, "cluster-1")

	require.NoError(t, err, "the close ended on its own, not at a deadline")
	require.False(t, allowed)
}

// With no panel window able to answer there is nobody to wait for.
func TestClusterCloseWithOnlyPanelWindowsThatCannotAnswerClosesAtOnce(t *testing.T) {
	registry, backend, source, windows := clusterCloseFixture(t)
	require.NoError(t, registry.WithdrawRendererReady(windows[0]))
	require.NoError(t, registry.WithdrawRendererReady(windows[1]))
	var closed []string
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }
	registry.emitWindowEvent = func(target, event string, _ any) bool {
		if event == panelwindow.ClusterPanelCloseRequestedEventName {
			t.Errorf("window %q was asked to run close guards it cannot run", target)
		}
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	allowed, err := registry.CloseClusterView(ctx, source, "cluster-1")

	require.NoError(t, err)
	require.True(t, allowed)
	require.ElementsMatch(t, windows[:2], closed)
	require.Equal(t, []string{"cluster-2"}, backend.windowClusters[source], "the cluster view closed")
}

// A panel window whose renderer cannot answer can be closed by its own close
// button while its cluster's windows are closing. The cluster close finishes
// instead of stopping half way.
func TestClusterCloseFinishesWhenAPanelWindowClosesWhileItCommits(t *testing.T) {
	registry, backend, source, windows := clusterCloseFixture(t)
	require.NoError(t, registry.WithdrawRendererReady(windows[0]))
	require.NoError(t, registry.WithdrawRendererReady(windows[1]))
	registry.closeWindow = func(name string) bool {
		if name == windows[0] {
			// The second window closes on its own, as its close button closes it.
			registry.panels.Remove(windows[1])
		}
		return true
	}

	allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")

	require.NoError(t, err)
	require.True(t, allowed)
	require.Equal(t, []string{"cluster-2"}, backend.windowClusters[source], "the cluster view closed")
}
