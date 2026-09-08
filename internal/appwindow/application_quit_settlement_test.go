package appwindow

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
)

func TestQuitSettlementKeepsApprovalFrozenUntilProcessHandoff(t *testing.T) {
	for _, outcome := range []string{"denied", "collection-timeout", "delivery-failed", "quit-unavailable", "handoff-timeout", "persistence-denied", "approved"} {
		t.Run(outcome, func(t *testing.T) {
			registry, backend, source, panels := clusterCloseFixture(t)
			registry.markWorkspaceReady(source)
			registry.quitPreflightTimeout = 0
			backend.allowQuit = outcome != "persistence-denied"
			participants := append([]string{source}, panels...)
			var id string
			settled := make(map[string]string)
			registry.emitWindowEvent = func(target, name string, payload any) bool {
				switch name {
				case panelwindow.ApplicationQuitPreflightRequestedEventName:
					id = payload.(panelwindow.ApplicationQuitPreflightRequestedEvent).TransactionID
					return outcome != "delivery-failed" || target != panels[0]
				case panelwindow.ApplicationQuitPreflightSettledEventName:
					event := payload.(panelwindow.ApplicationQuitPreflightRequestedEvent)
					require.Equal(t, target, event.WindowName)
					settled[target] = event.TransactionID
					registry.quitMu.Lock()
					registry.quitMu.Unlock()
				}
				return true
			}
			registry.closeWindow = func(string) bool {
				t.Error("process quit must not close individual views before shutdown")
				return true
			}
			quitRequests := 0
			registry.requestApplicationQuit = func() { quitRequests++ }
			if outcome == "quit-unavailable" {
				registry.requestApplicationQuit = nil
			}
			require.False(t, registry.PrepareApplicationQuit())
			collecting := registry.pendingQuit
			if outcome != "delivery-failed" {
				require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(source, id, true))
				require.Empty(t, settled, "an approved renderer remains frozen while its peers decide")
				switch outcome {
				case "collection-timeout":
					registry.expireApplicationQuitPreflight(collecting)
				case "denied":
					require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(panels[0], id, false))
				default:
					for i, panel := range panels {
						err := registry.AcknowledgeApplicationQuitPreflight(panel, id, true)
						if outcome == "quit-unavailable" && i == len(panels)-1 {
							require.ErrorContains(t, err, "unavailable")
						} else {
							require.NoError(t, err)
						}
					}
					if outcome != "quit-unavailable" {
						require.Equal(t, 1, quitRequests)
						require.Empty(t, settled)
						registry.expireApplicationQuitPreflight(collecting)
						require.NotNil(t, registry.pendingQuit, "a stale collection timer cannot cancel the handoff")
						handoff := registry.pendingQuit
						if outcome == "handoff-timeout" {
							registry.expireApplicationQuitPreflight(handoff)
						} else {
							require.Equal(t, outcome == "approved", registry.PrepareApplicationQuit())
							registry.expireApplicationQuitPreflight(handoff)
						}
					}
				}
			}
			require.Equal(t, 1, registry.Count())
			require.ElementsMatch(t, panels, registry.panels.Names(""))
			if outcome == "approved" {
				require.Empty(t, settled, "approved renderers stay frozen until process teardown")
				require.NotNil(t, registry.pendingQuit, "a stale handoff timer cannot cancel persistence")
				return
			}
			require.Nil(t, registry.pendingQuit)
			require.Len(t, settled, len(participants))
			for _, name := range participants {
				require.Equal(t, id, settled[name])
			}
			previousID := id
			registry.emitWindowEvent = func(_ string, event string, payload any) bool {
				if event == panelwindow.ApplicationQuitPreflightRequestedEventName {
					id = payload.(panelwindow.ApplicationQuitPreflightRequestedEvent).TransactionID
				}
				return true
			}
			require.False(t, registry.PrepareApplicationQuit())
			require.NotEqual(t, previousID, id, "a rejected handoff permits a fresh quit attempt")
		})
	}
}
