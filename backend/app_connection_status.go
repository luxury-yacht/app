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
