package genkindfacets

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/kind/logspec"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/stretchr/testify/require"
)

// jsonKeys lists the JSON keys a struct type marshals.
func jsonKeys(t reflect.Type) []string {
	keys := make([]string, 0, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		name, _, _ := strings.Cut(t.Field(i).Tag.Get("json"), ",")
		keys = append(keys, name)
	}
	sort.Strings(keys)
	return keys
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// Every registered kind gets one row, and every row writes every facet, so the
// frontend never reads an absent facet as "false".
func TestRowsCoverEveryRegisteredKindWithEveryFacet(t *testing.T) {
	rows, err := Rows()
	require.NoError(t, err)
	require.Len(t, rows, len(kindregistry.All))

	seen := map[string]bool{}
	for i, row := range rows {
		if i > 0 {
			require.Less(t, rows[i-1].Kind, row.Kind, "rows are sorted by kind")
		}
		key := row.Group + "/" + strings.ToLower(row.Kind)
		require.Falsef(t, seen[key], "duplicate group/kind %s", key)
		seen[key] = true

		encoded, err := json.Marshal(row)
		require.NoError(t, err)
		var decoded map[string]any
		require.NoError(t, json.Unmarshal(encoded, &decoded))
		require.Equal(t, jsonKeys(reflect.TypeOf(Row{})), sortedKeys(decoded), row.Kind)
		require.Equal(t, jsonKeys(reflect.TypeOf(Panel{})), sortedKeys(decoded["panel"].(map[string]any)), row.Kind)
		require.Equal(t, jsonKeys(reflect.TypeOf(Actions{})), sortedKeys(decoded["actions"].(map[string]any)), row.Kind)
		require.Equal(t, jsonKeys(reflect.TypeOf(Display{})), sortedKeys(decoded["display"].(map[string]any)), row.Kind)
		require.NotEmpty(t, row.Display.ShortName, row.Kind)
		require.NotEmpty(t, row.Display.Label, row.Kind)
		require.NotNil(t, row.Display.SearchAliases, "%s: search aliases are written as a list", row.Kind)
	}
	for _, descriptor := range kindregistry.All {
		row := rowFor(t, rows, descriptor.Identity.Kind)
		require.Equal(t, descriptor.Identity.Group, row.Group)
		require.Contains(t, row.Versions, descriptor.Identity.Version, "the registry version is always served")
	}
}

func rowFor(t *testing.T, rows []Row, kind string) Row {
	t.Helper()
	for _, row := range rows {
		if row.Kind == kind {
			return row
		}
	}
	t.Fatalf("no row for %s", kind)
	return Row{}
}

// The generated values keep today's frontend decisions: each kind keeps exactly
// the tabs, logs mode, shell, metrics source, and actions it has now.
func TestRowsKeepTodaysKindDecisions(t *testing.T) {
	rows, err := Rows()
	require.NoError(t, err)

	type decision struct {
		pods, logs, shell, metrics string
		jobs, debug                bool
	}
	expected := map[string]decision{
		"Pod":         {pods: "none", logs: "pod", shell: "exec", metrics: "pods", debug: true},
		"Deployment":  {pods: "owner", logs: "owned-pods", shell: "none", metrics: "namespace-workloads"},
		"StatefulSet": {pods: "owner", logs: "owned-pods", shell: "none", metrics: "namespace-workloads"},
		"DaemonSet":   {pods: "owner", logs: "owned-pods", shell: "none", metrics: "namespace-workloads"},
		"ReplicaSet":  {pods: "owner", logs: "owned-pods", shell: "none", metrics: "none"},
		"Job":         {pods: "owner", logs: "owned-pods", shell: "none", metrics: "none"},
		"CronJob":     {pods: "none", jobs: true, logs: "owned-pods", shell: "none", metrics: "none"},
		"Node":        {pods: "node", logs: "node", shell: "node", metrics: "nodes"},
	}
	for _, row := range rows {
		want, special := expected[row.Kind]
		if !special {
			want = decision{pods: "none", logs: "none", shell: "none", metrics: "none"}
		}
		got := decision{
			pods: row.Panel.Pods, logs: row.Panel.Logs, shell: row.Panel.Shell,
			metrics: row.MetricsDomain, jobs: row.Panel.Jobs, debug: row.Panel.DebugContainer,
		}
		require.Equal(t, want, got, row.Kind)
		hidesOwnTabs := row.Kind == "Event"
		require.Equal(t, !hidesOwnTabs, row.Panel.EventsTab, row.Kind)
		require.Equal(t, !hidesOwnTabs, row.Panel.YAMLTab, row.Kind)
		require.Equal(t, row.Kind == "Namespace", row.Actions.RemoveNamespaceFinalizer, row.Kind)
	}

	require.Equal(t, Actions{Restart: true, Rollback: true, Scale: true, PortForward: true, Reconnect: true}, rowFor(t, rows, "Deployment").Actions)
	require.Equal(t, Actions{Scale: true}, rowFor(t, rows, "ReplicaSet").Actions)
	require.Equal(t, Actions{Restart: true, Rollback: true, PortForward: true, Reconnect: true}, rowFor(t, rows, "DaemonSet").Actions)
	require.Equal(t, Actions{Trigger: true, Suspend: true}, rowFor(t, rows, "CronJob").Actions)
	require.Equal(t, Actions{Cordon: true, Drain: true}, rowFor(t, rows, "Node").Actions)
	require.Equal(t, Actions{PortForward: true, Reconnect: true, UsesServicePortSpec: true}, rowFor(t, rows, "Service").Actions)
	require.Equal(t, Actions{PortForward: true}, rowFor(t, rows, "Pod").Actions)

	hpa := rowFor(t, rows, "HorizontalPodAutoscaler")
	require.Equal(t, []string{"v1", "v2"}, hpa.Versions, "both served HPA versions are listed")
	require.Equal(t, "deployment", rowFor(t, rows, "Deployment").DetailType)
	require.Equal(t, Display{ShortName: "deploy", Label: "Deployment", SearchAliases: []string{}}, rowFor(t, rows, "Deployment").Display)
	require.Equal(t, Display{ShortName: "mwc", Label: "MutatingWebhook", SearchAliases: []string{}}, rowFor(t, rows, "MutatingWebhookConfiguration").Display)
	require.Equal(t, []string{"cj"}, rowFor(t, rows, "CronJob").Display.SearchAliases)
	require.Equal(t, "namespace-config", rowFor(t, rows, "ConfigMap").ListDomain, "streamed kinds list in their stream domain")
	require.Equal(t, "namespace-workloads", rowFor(t, rows, "Deployment").ListDomain)
	require.Equal(t, "none", rowFor(t, rows, "ReplicaSet").ListDomain, "no domain lists ReplicaSets")
	require.True(t, rowFor(t, rows, "Deployment").ObjectMap)
	require.False(t, rowFor(t, rows, "Event").ObjectMap)
}

// The log viewer reads an owned-pods target's pod names from its detail, so
// every owned-pods kind must list its pods there.
func TestOwnedPodsLogsNeedDetailListsPods(t *testing.T) {
	rows, err := Rows()
	require.NoError(t, err)
	for _, row := range rows {
		if row.Panel.Logs == "owned-pods" {
			require.Truef(t, row.DetailListsPods, "%s logs its owned pods but its detail lists none", row.Kind)
		}
	}
}

func TestRenderWritesTheSchemaCheckedLiteral(t *testing.T) {
	generated, err := Render()
	require.NoError(t, err)
	contract := string(generated)
	require.True(t, strings.HasPrefix(contract, "// Code generated by genkindfacets; DO NOT EDIT."))
	require.Contains(t, contract, "export interface KindFacetsSchema")
	require.Contains(t, contract, "] as const satisfies readonly KindFacetsSchema[];")
	require.Contains(t, contract, `"kind":"Deployment"`)
	require.Contains(t, contract, `"versions":["v1","v2"]`)
}

// A kind's Logs tab reads either its containers (a Logs target) or the node's
// own logs, never both.
func TestPanelRejectsBothContainerAndNodeLogs(t *testing.T) {
	descriptor := kindspec.Descriptor{
		Identity: resourcekind.Identity{Version: "v1", Kind: "Node"},
		Logs:     &logspec.Target{},
		Panel:    kindspec.ObjectPanel{NodeLogs: true},
	}
	_, err := panelOf(descriptor)
	require.Error(t, err)

	descriptor.Logs = &logspec.Target{SinglePod: true}
	descriptor.Panel = kindspec.ObjectPanel{}
	panel, err := panelOf(descriptor)
	require.NoError(t, err)
	require.Equal(t, "pod", panel.Logs)
}
