package externalsecrets

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestClusterTemplateTargetsGeneratedSecretNameWithoutInventingNamespace(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "external-secrets.io/v1", "kind": "ClusterExternalSecret", "metadata": map[string]any{"name": "distribution"},
		"spec": map[string]any{"externalSecretName": "database", "namespaces": []any{"team-a"}, "externalSecretSpec": map[string]any{
			"secretStoreRef": map[string]any{"name": "team-vault", "kind": "SecretStore"},
			"data":           []any{map[string]any{"secretKey": "password", "remoteRef": map[string]any{"key": "db", "property": "password"}}},
		}},
		"status": map[string]any{"provisionedNamespaces": []any{"team-a"}, "failedNamespaces": []any{map[string]any{"namespace": "team-b", "reason": "Denied"}}},
	}}
	facts := BuildFacts("a", object)
	require.Equal(t, "database", facts.ClusterExternalSecret.Template.TargetName)
	require.Nil(t, facts.ClusterExternalSecret.Template.Target)
	require.Nil(t, facts.ClusterExternalSecret.Template.Store)
	require.Equal(t, "db", facts.ClusterExternalSecret.Template.Data[0].RemoteRef.Key)
	require.Equal(t, "team-b", facts.ClusterExternalSecret.FailedNamespaces[0].Namespace)
}

func TestSecretStoreProjectionExcludesProviderCredentialsAndRetainsAccessConstraints(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "external-secrets.io/v1", "kind": "ClusterSecretStore", "metadata": map[string]any{"name": "vault"},
		"spec":   map[string]any{"provider": map[string]any{"vault": map[string]any{"token": "private-token"}}, "refreshInterval": int64(0), "retrySettings": map[string]any{"maxRetries": int64(0), "retryInterval": "1s"}, "conditions": []any{map[string]any{"namespaceSelector": map[string]any{"matchLabels": map[string]any{"team": "a"}}}}},
		"status": map[string]any{"capabilities": "ReadOnly", "conditions": []any{map[string]any{"type": "Ready", "status": "Unknown"}}},
	}}
	facts := BuildFacts("a", object)
	require.Equal(t, []string{"vault"}, facts.Store.Providers)
	require.Zero(t, *facts.Store.RefreshInterval)
	require.Zero(t, *facts.Store.RetrySettings.MaxRetries)
	require.Equal(t, "a", facts.Store.Conditions[0].NamespaceSelector.MatchLabels["team"])
	encoded, err := json.Marshal(facts)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private-token")
	_, _, presentation, ok := PrimaryStatus(object)
	require.True(t, ok)
	require.Equal(t, "unknown", presentation)
	require.Nil(t, BuildFacts("a", nil))
}
