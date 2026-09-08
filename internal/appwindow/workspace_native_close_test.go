package appwindow

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestNativeWorkspaceClosePreservesGuardsWhenShutdownIsRejected(t *testing.T) {
	for _, allowed := range []bool{false, true} {
		t.Run(map[bool]string{false: "rejected", true: "approved"}[allowed], func(t *testing.T) {
			backend := &recordingLifecycleBackend{allowQuit: allowed}
			registry := NewRegistry(application.New(application.Options{}), backend)
			registry.quitPreflightTimeout = 0
			name := registry.Create(true).Name()
			registry.markWorkspaceReady(name)
			var requested, settled []string
			registry.emitWindowEvent = func(target, eventName string, _ any) bool {
				switch eventName {
				case panelwindow.WorkspaceCloseRequestedEventName:
					requested = append(requested, target)
				case panelwindow.ApplicationQuitPreflightSettledEventName:
					settled = append(settled, target)
				}
				return true
			}
			firstClose := &application.WindowEvent{}
			registry.handleClosing(firstClose, name)
			require.True(t, firstClose.IsCancelled())
			require.Equal(t, []string{name}, requested)
			require.Empty(t, backend.preparedWindow)
			require.Equal(t, 1, registry.Count())

			require.False(t, registry.PrepareApplicationQuit())
			authorizedClose := &application.WindowEvent{}
			registry.closeWindow = func(target string) bool {
				registry.handleClosing(authorizedClose, target)
				return true
			}
			require.NoError(t, registry.AcknowledgeWorkspaceWindowClose(name))
			require.Equal(t, !allowed, authorizedClose.IsCancelled())
			require.Equal(t, name, backend.preparedWindow)
			require.Empty(t, backend.releasedWindow, "the last view selection survives process shutdown")
			require.Equal(t, !allowed, registry.lifecycle.Contains(name))
			require.Equal(t, !allowed, registry.isWorkspaceReady(name), "rejected shutdown retains renderer guards")
			if !allowed {
				require.Equal(t, []string{name}, settled)
				require.Nil(t, registry.pendingQuit)
				nextClose := &application.WindowEvent{}
				registry.handleClosing(nextClose, name)
				require.True(t, nextClose.IsCancelled())
				require.Equal(t, []string{name, name}, requested)
			}
		})
	}
}
