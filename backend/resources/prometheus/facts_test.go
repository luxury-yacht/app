package prometheus

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestMonitorProjectionPreservesNumericPortsSelectorsAndSourceObject(t *testing.T) {
	for _, kind := range []string{"ServiceMonitor", "PodMonitor"} {
		endpointKey := "endpoints"
		if kind == "PodMonitor" {
			endpointKey = "podMetricsEndpoints"
		}
		object := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "monitoring.coreos.com/v1", "kind": kind, "metadata": map[string]any{"name": "web", "namespace": "team-a"}, "spec": map[string]any{
			"selector":          map[string]any{"matchExpressions": []any{map[string]any{"key": "app", "operator": "In", "values": []any{"web"}}}},
			"namespaceSelector": map[string]any{"any": false, "matchNames": []any{"team-b"}}, "sampleLimit": int64(0),
			endpointKey: []any{map[string]any{"targetPort": int64(9090), "interval": "15s", "honorLabels": false, "bearerTokenSecret": map[string]any{"key": "private-token"}}},
		}}}
		before := object.DeepCopy()
		facts := BuildFacts("a", object)
		require.Equal(t, "9090", facts.Monitor.Endpoints[0].TargetPort)
		require.False(t, *facts.Monitor.Endpoints[0].HonorLabels)
		require.Zero(t, *facts.Monitor.SampleLimit)
		require.Equal(t, []string{"team-b"}, facts.Monitor.NamespaceSelector.MatchNames)
		require.Equal(t, []string{"web"}, facts.Monitor.Selector.MatchExpressions[0].Values)
		require.Equal(t, before, object)
		encoded, err := json.Marshal(facts)
		require.NoError(t, err)
		require.NotContains(t, string(encoded), "private-token")
	}
}

func TestRuleExpressionsAndInstanceSelectionRetainMissingVersusEmpty(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "monitoring.coreos.com/v1", "kind": "PrometheusRule", "metadata": map[string]any{"name": "web", "namespace": "team-a"}, "spec": map[string]any{"groups": []any{map[string]any{"name": "availability", "rules": []any{map[string]any{"record": "zero", "expr": int64(0)}, map[string]any{"alert": "Down", "expr": "up == 0", "for": "5m"}}}}}}}
	facts := BuildFacts("a", object)
	require.Equal(t, "0", facts.RuleGroups[0].Rules[0].Expr)
	require.Equal(t, "up == 0", facts.RuleGroups[0].Rules[1].Expr)
	object.SetKind("Prometheus")
	object.Object["spec"] = map[string]any{"replicas": int64(0), "serviceMonitorSelector": map[string]any{}, "ruleNamespaceSelector": map[string]any{"matchLabels": map[string]any{"team": "a"}}}
	facts = BuildFacts("a", object)
	require.NotNil(t, facts.Instance.ServiceMonitorSelector)
	require.Nil(t, facts.Instance.PodMonitorSelector)
	require.Nil(t, facts.Instance.ServiceMonitorNamespaceSelector)
	require.Zero(t, *facts.Instance.Replicas)
	object.SetKind("Alertmanager")
	object.Object["spec"] = map[string]any{"configSecret": "alertmanager-config"}
	object.Object["status"] = map[string]any{"conditions": []any{map[string]any{"type": "Available", "status": "True"}, map[string]any{"type": "Reconciled", "status": "False"}}}
	_, _, presentation, ok := PrimaryStatus(object)
	require.True(t, ok)
	require.Equal(t, "error", presentation)
	require.Equal(t, "alertmanager-config", BuildFacts("a", object).Instance.ConfigSecret)
	object.SetGeneration(3)
	object.Object["status"] = map[string]any{"conditions": []any{
		map[string]any{"type": "Available", "status": "True", "observedGeneration": int64(2)},
		map[string]any{"type": "Reconciled", "status": "False", "observedGeneration": int64(2)},
	}}
	_, _, presentation, _ = PrimaryStatus(object)
	require.Equal(t, "progressing", presentation, "an older failed configuration must not describe the current generation")
	object.SetKind("ServiceMonitor")
	delete(object.Object, "spec")
	require.NotNil(t, BuildFacts("a", object).Monitor)
	require.Nil(t, BuildFacts("a", nil))
}
