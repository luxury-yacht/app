package backend

import (
	"time"
)

// ConnectionState enumerates backend connectivity states for diagnostics/UI.
type ConnectionState string

const (
	ConnectionStateHealthy    ConnectionState = "healthy"
	ConnectionStateRetrying   ConnectionState = "retrying"
	ConnectionStateOffline    ConnectionState = "offline"
	ConnectionStateAuthFailed ConnectionState = "auth_failed"
	ConnectionStateRebuilding ConnectionState = "rebuilding"
)

type connectionStateMeta struct {
	Label          string
	Description    string
	DefaultMessage string
}

var connectionStateDefinitions = map[ConnectionState]connectionStateMeta{
	ConnectionStateHealthy: {
		Label:          "Connected",
		Description:    "Successfully connected to the Kubernetes API server.",
		DefaultMessage: "Connected to cluster",
	},
	ConnectionStateRetrying: {
		Label:          "Retrying",
		Description:    "Transient connectivity issue detected. The backend is retrying the request.",
		DefaultMessage: "Retrying request",
	},
	ConnectionStateOffline: {
		Label:          "Offline",
		Description:    "Unable to contact the Kubernetes API server.",
		DefaultMessage: "Lost connection to cluster",
	},
	ConnectionStateAuthFailed: {
		Label:          "Auth Required",
		Description:    "Authentication or RBAC failure detected.",
		DefaultMessage: "Authentication failure",
	},
	ConnectionStateRebuilding: {
		Label:          "Reconnecting",
		Description:    "Backend is rebuilding Kubernetes clients after a failure.",
		DefaultMessage: "Rebuilding client connections",
	},
}

func (a *App) updateConnectionStatus(state ConnectionState, message string, nextRetry time.Duration) {
	if a == nil {
		return
	}
	meta, ok := connectionStateDefinitions[state]
	if !ok {
		meta = connectionStateDefinitions[ConnectionStateHealthy]
		state = ConnectionStateHealthy
	}
	if message == "" {
		message = meta.DefaultMessage
	}

	nextRetryMs := nextRetry.Milliseconds()
	now := time.Now().UnixMilli()

	a.connectionStatusMu.Lock()
	if a.connectionStatus == state &&
		a.connectionStatusMessage == message &&
		a.connectionStatusNextRetry == nextRetryMs {
		a.connectionStatusMu.Unlock()
		return
	}
	a.connectionStatus = state
	a.connectionStatusMessage = message
	a.connectionStatusNextRetry = nextRetryMs
	a.connectionStatusUpdatedAt = now
	a.connectionStatusMu.Unlock()

	if a.telemetryRecorder != nil {
		a.telemetryRecorder.RecordConnectionState(string(state), meta.Label, message, nextRetryMs, now)
	}

	payload := map[string]any{
		"state":       string(state),
		"label":       meta.Label,
		"description": meta.Description,
		"message":     message,
		"updatedAt":   now,
	}
	if nextRetryMs > 0 {
		payload["nextRetryMs"] = nextRetryMs
	}
	a.emitEvent("connection-status", payload)
}
