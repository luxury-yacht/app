package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// handleClusterAuthStateChange handles auth state changes for a specific cluster.
// Unlike the global handleAuthStateChange, this only affects the specific cluster
// that experienced the auth failure, allowing other clusters to continue operating.
//
// NOTE: This is called from the auth manager with the mutex held, so heavy
// operations must be run asynchronously to avoid blocking other auth operations.
func (m *ClusterRuntimeManager) handleClusterAuthStateChange(clusterID string, state authstate.State, diag authstate.FailureDiagnostic) {
	if m == nil || clusterID == "" {
		return
	}

	command, ok := newClusterAuthStateCommand(clusterID, m.clusterAuthDisplayName(clusterID), state, diag)
	if !ok {
		return
	}

	m.reportClusterAuthState(command)
	m.emitEvent(command.eventName, command.eventPayload)
	m.applyClusterAuthLifecycle(command)
	if command.mutation != clusterAuthMutationNone {
		m.intents.Publish(ClusterRuntimeIntent{
			Kind:       ClusterRuntimeIntentAuthRebuild,
			ClusterID:  clusterID,
			Generation: m.intentGeneration.Add(1),
			AuthState:  state,
			Diagnostic: diag,
		})
	}
}

func (m *ClusterRuntimeManager) clusterAuthDisplayName(clusterID string) string {
	clients := m.clusterClientsForID(clusterID)
	if clients == nil {
		return clusterID
	}
	return clients.meta.Name
}

func (m *ClusterRuntimeManager) reportClusterAuthState(command clusterAuthStateCommand) {
	switch command.state {
	case authstate.StateValid:
		m.logger.Info(fmt.Sprintf("Cluster %s: auth recovered", command.clusterName), logsources.Auth, command.clusterID, command.clusterName)
	case authstate.StateRecovering:
		m.logger.Warn(fmt.Sprintf("Cluster %s: auth recovering - %s", command.clusterName, command.diagnostic.Reason), logsources.Auth, command.clusterID, command.clusterName)
	case authstate.StateInvalid:
		m.reportInvalidClusterAuthState(command)
	}
}

func (m *ClusterRuntimeManager) reportInvalidClusterAuthState(command clusterAuthStateCommand) {
	m.logger.Warn(fmt.Sprintf("Cluster %s: auth failed - %s", command.clusterName, command.diagnostic.Reason), logsources.Auth, command.clusterID, command.clusterName)
	errorcapture.CaptureWithCluster(command.clusterID, fmt.Sprintf("auth failed: %s", command.diagnostic.Reason))
}

func (m *ClusterRuntimeManager) applyClusterAuthLifecycle(command clusterAuthStateCommand) {
	if command.state != authstate.StateInvalid || m.clusterLifecycle == nil {
		return
	}
	m.clusterLifecycle.SetState(command.clusterID, ClusterStateAuthFailed)
}

// RetryClusterAuth triggers a manual authentication recovery attempt for a specific cluster.
// Called when user clicks "Retry" for a specific cluster after re-authenticating externally.
func (m *ClusterRuntimeManager) RetryClusterAuth(clusterID string) {
	if m == nil || clusterID == "" {
		return
	}

	clients := m.clusterClientsForID(clusterID)
	if clients == nil || clients.authManager == nil {
		return
	}

	clients.authManager.TriggerRetry()
}

// GetClusterAuthState returns the current auth state for a specific cluster.
func (m *ClusterRuntimeManager) GetClusterAuthState(clusterID string) (string, string) {
	if m == nil || clusterID == "" {
		return "unknown", ""
	}

	clients := m.clusterClientsForID(clusterID)
	if clients == nil || clients.authManager == nil {
		return "unknown", ""
	}

	state, reason := clients.authManager.State()
	return state.String(), reason
}

// handleClusterAuthRecoveryProgress handles recovery progress updates for a specific cluster.
// This is called periodically during recovery to allow the frontend to show countdowns.
func (m *ClusterRuntimeManager) handleClusterAuthRecoveryProgress(clusterID string, progress authstate.RecoveryProgress) {
	if m == nil || clusterID == "" {
		return
	}

	// Get cluster name and the stored failure diagnostic. FailureDiagnostic is
	// read outside the manager's lock (OnRecoveryProgress fires after emitProgress
	// releases it), so this cannot deadlock.
	clusterName := clusterID
	var diag authstate.FailureDiagnostic
	if clients := m.clusterClientsForID(clusterID); clients != nil {
		clusterName = clients.meta.Name
		if clients.authManager != nil {
			diag = clients.authManager.FailureDiagnostic()
		}
	}

	// Emit per-cluster progress event for the frontend. errorClass carries the
	// latest probe verdict ("auth", "connectivity", or "" before any verdict)
	// so the UI can distinguish an unreachable cluster from rejected credentials.
	// The typed diagnostic fields let a late-subscribing UI render exec-helper
	// copy without having seen the failed/recovering event.
	payload := authEventPayload(clusterID, clusterName, diag)
	m.emitEvent(clusterAuthProgressEventName, ClusterAuthProgressEvent{
		ClusterID:         payload.ClusterID,
		ClusterName:       payload.ClusterName,
		Reason:            payload.Reason,
		Class:             payload.Class,
		Kind:              payload.Kind,
		Summary:           payload.Summary,
		ExecCommand:       payload.ExecCommand,
		SecondsUntilRetry: progress.SecondsUntilRetry,
		ErrorClass:        string(progress.ErrorClass),
	})
}
