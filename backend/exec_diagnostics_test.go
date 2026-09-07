package backend

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestExecDiagnosticsPreservePoliciesAndStableClusterIdentity(t *testing.T) {
	var store execDiagnosticStore
	t.Cleanup(store.close)
	for _, policy := range []clientcmdapi.PolicyType{clientcmdapi.PluginPolicyDenyAll, clientcmdapi.PluginPolicyAllowlist} {
		config := &rest.Config{ExecProvider: &clientcmdapi.ExecConfig{Command: "aws", PluginPolicy: clientcmdapi.PluginPolicy{PolicyType: policy}}}
		require.NoError(t, store.prepare("a", config))
		require.Equal(t, "aws", config.ExecProvider.Command)
		require.Empty(t, config.ExecProvider.Env)
	}
	require.NoError(t, store.prepare("", &rest.Config{}))
	require.Error(t, store.prepare("", &rest.Config{ExecProvider: &clientcmdapi.ExecConfig{Command: "aws"}}))
	first, err := store.pathForCluster("a")
	require.NoError(t, err)
	again, err := store.pathForCluster("a")
	require.NoError(t, err)
	other, err := store.pathForCluster("b")
	require.NoError(t, err)
	require.Equal(t, first, again, "client-go cache identity must remain stable within a cluster")
	require.NotEqual(t, first, other)
	store.close()
	_, err = store.pathForCluster("a")
	require.Error(t, err, "shutdown must also prevent late parent initialization from recreating the store")
	_, err = os.Stat(first)
	require.True(t, os.IsNotExist(err))
}

func TestExecDiagnosticsPersistOnlySanitizedFailureAndClearOnSuccess(t *testing.T) {
	var store execDiagnosticStore
	t.Cleanup(store.close)
	config := &rest.Config{ExecProvider: &clientcmdapi.ExecConfig{Command: "aws"}}
	require.NoError(t, store.prepare("a", config))
	path, err := store.pathForCluster("a")
	require.NoError(t, err)
	var capture diagnosticStderr
	_, err = capture.Write([]byte(strings.Repeat("x", 100_000)))
	require.NoError(t, err)
	_, err = capture.Write([]byte("SSO token has expired: private-provider-details"))
	require.NoError(t, err)
	require.LessOrEqual(t, len(capture.tail), 64*1024)
	capture.publish(path, errors.New("exit status 255"))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "expired-credentials", string(data))
	helperError := errors.New("exec plugin failed with exit code 255")
	require.Equal(t, credentialerrors.KindExpired, classifyClusterCredentialError(helperError, config).Kind)
	require.Equal(t, credentialerrors.KindConnectivity, classifyClusterCredentialError(errors.New("connection refused"), config).Kind)
	capture.publish(path, nil)
	require.Equal(t, credentialerrors.KindHelperFailed, classifyClusterCredentialError(helperError, config).Kind)
	store.close()
	capture.publish(path, helperError)
	_, err = os.Stat(path)
	require.True(t, os.IsNotExist(err), "late helpers must not recreate closed stores")
	require.Equal(t, credentialerrors.KindHelperFailed, classifyClusterCredentialError(helperError, config).Kind)
}

func TestExecDiagnosticsClassifyMissingHelper(t *testing.T) {
	var store execDiagnosticStore
	t.Cleanup(store.close)
	config := &rest.Config{ExecProvider: &clientcmdapi.ExecConfig{Command: filepath.Join(t.TempDir(), "absent-helper")}}
	require.NoError(t, store.prepare("missing", config))
	path, err := store.pathForCluster("missing")
	require.NoError(t, err)
	t.Setenv(execDiagnosticFileEnv, path)
	require.Equal(t, 1, runExecWrapper(execDisplayCommand(config), nil))
	diagnostic := classifyClusterCredentialError(errors.New("exec plugin failed with exit code 1"), config)
	require.Equal(t, credentialerrors.KindMissingHelper, diagnostic.Kind)
}
