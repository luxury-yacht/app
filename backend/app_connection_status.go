package backend

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

// NOTE: updateConnectionStatus() has been removed as part of the multi-cluster isolation refactor.
// Connection status is now tracked and emitted per-cluster via:
// - cluster:health:healthy / cluster:health:degraded events (from runHeartbeatIteration)
// - cluster:auth:failed / cluster:auth:recovering / cluster:auth:recovered events (from handleClusterAuthStateChange)
// The ConnectionState type and connectionStateDefinitions are kept for backwards compatibility
// and may still be used by telemetry or other components that need state labels.
