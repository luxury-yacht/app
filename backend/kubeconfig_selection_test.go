package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseKubeconfigSelection_WindowsPath(t *testing.T) {
	selection := `C:\\Users\\John\\.kube\\default:minikube`

	parsed, err := parseKubeconfigSelection(selection)
	require.NoError(t, err)
	require.Equal(t, `C:\\Users\\John\\.kube\\default`, parsed.Path)
	require.Equal(t, "minikube", parsed.Context)
}

func TestParseKubeconfigSelection_ContextWithColon(t *testing.T) {
	selection := `C:\\Users\\John\\.kube\\config:team:alpha`

	parsed, err := parseKubeconfigSelection(selection)
	require.NoError(t, err)
	require.Equal(t, `C:\\Users\\John\\.kube\\config`, parsed.Path)
	require.Equal(t, "team:alpha", parsed.Context)
}
