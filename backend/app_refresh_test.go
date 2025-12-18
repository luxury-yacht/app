package backend

import (
    "testing"

    "github.com/stretchr/testify/require"
)

func TestGetRefreshBaseURL(t *testing.T) {
    app := newTestAppWithDefaults(t)

    _, err := app.GetRefreshBaseURL()
    require.Error(t, err)

    app.refreshBaseURL = "http://localhost:8080"
    url, err := app.GetRefreshBaseURL()
    require.NoError(t, err)
    require.Equal(t, "http://localhost:8080", url)
}
