package backend

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func TestGetCatalogDiagnosticsFromTelemetryRecorder(t *testing.T) {
	recorder := telemetry.NewRecorder()
	recorder.RecordCatalog(true, 5, 2, 1500*time.Millisecond, errors.New("collect failed"))
	recorder.RecordSnapshot("pods", "default", 50*time.Millisecond, nil, false, 3, nil, 1, 0, 0, true, 25)

	app := &App{telemetryRecorder: recorder}

	diag, err := app.GetCatalogDiagnostics()
	require.NoError(t, err)

	require.True(t, diag.Enabled)
	require.Equal(t, 5, diag.ItemCount)
	require.Equal(t, 2, diag.ResourceCount)
	require.Equal(t, "collect failed", diag.LastError)
	require.Len(t, diag.Domains, 1)
	require.Equal(t, "pods", diag.Domains[0].Domain)
}
