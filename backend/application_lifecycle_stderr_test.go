package backend

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// Stderr carries no cluster identity, so one cluster's auth failure must not
// hide every other cluster's client-library output from App Logs. Repeats are
// already suppressed per line by the capture itself.
func TestCapturedStderrIsLoggedWhileAnotherClusterAuthIsInvalid(t *testing.T) {
	fixture := newClusterRuntimeTestFixture(t)
	manager := authstate.New(authstate.Config{MaxAttempts: 0})
	manager.ReportFailure("expired credentials")
	fixture.ClusterRuntime.clusterClientsMu.Lock()
	fixture.ClusterRuntime.setClusterClientLocked("broken", &clusterClients{
		meta: ClusterMeta{ID: "broken", Name: "Broken"}, authManager: manager,
	})
	fixture.ClusterRuntime.clusterClientsMu.Unlock()

	const line = `E1011 10:00:00.000001 1 reflector.go:569] "Failed to watch" err="secrets \"ci-token\" timed out"`
	fixture.Lifecycle.logCapturedStderr("error", line)

	var logged []LogEntry
	for _, entry := range fixture.AppLogs.Logger().GetEntries() {
		if entry.Source == logsources.ErrorCapture {
			logged = append(logged, entry)
		}
	}
	require.Len(t, logged, 1)
	require.Equal(t, line, logged[0].Message)
}
