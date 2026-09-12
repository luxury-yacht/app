package argocd

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func resource(kind, spec, status string) *unstructured.Unstructured {
	object := &unstructured.Unstructured{}
	if err := object.UnmarshalJSON([]byte(`{"apiVersion":"argoproj.io/v1alpha1","kind":"` + kind + `","metadata":{"name":"shop","namespace":"team-a"},"spec":` + spec + `,"status":` + status + `}`)); err != nil {
		panic(err)
	}
	return object
}

func TestApplicationProjectionPreservesHealthAndSyncWithoutRawConfiguration(t *testing.T) {
	object := resource("Application", `{"project":"production","destination":{"name":"remote-prod","namespace":"store"},"sources":[{"repoURL":"https://git.example.com/config","path":"apps/shop","targetRevision":"main","helm":{"values":"secret=do-not-project"}},{"repoURL":"https://charts.example.com","chart":"shop","targetRevision":"2.1"}],"syncPolicy":{"automated":{"enabled":false,"prune":true}}}`, `{"health":{"status":"Degraded","message":"Deployment unavailable"},"sync":{"status":"Synced","revisions":["abc","2.1"]},"resources":[],"operationState":{"phase":"Failed","message":"Apply failed","startedAt":"2026-09-01T00:00:00Z"},"conditions":[{"type":"ComparisonError","message":"Repository unavailable"}]}`)
	object.SetOwnerReferences(nil)
	require.NoError(t, unstructured.SetNestedSlice(object.Object, []any{map[string]any{"apiVersion": "argoproj.io/v1beta1", "kind": "ApplicationSet", "name": "shops", "uid": "owner"}}, "metadata", "ownerReferences"))
	facts := BuildFacts("cluster-a", object)
	require.Equal(t, "ready", facts.Application.SyncPresentation)
	require.Equal(t, "error", facts.Application.HealthPresentation)
	require.Equal(t, []string{"abc", "2.1"}, facts.Application.Revisions)
	require.Equal(t, int64(0), *facts.Application.ResourceCount)
	require.False(t, *facts.Application.Spec.SyncPolicy.Automated.Enabled)
	require.Equal(t, "remote-prod", facts.Application.Spec.Destination.Name)
	require.Equal(t, "Failed", facts.Application.Operation.Phase)
	ref := facts.Application.ApplicationSet.Ref
	require.Equal(t, "cluster-a", ref.ClusterID)
	require.Equal(t, "team-a", ref.Namespace)
	require.Equal(t, "v1beta1", ref.Version)
	require.Equal(t, "error", facts.Conditions[0].Presentation)
	encoded, err := json.Marshal(facts)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "do-not-project")
	state, label, presentation, ok := PrimaryStatus(object)
	require.True(t, ok)
	require.Equal(t, "Degraded", state)
	require.Equal(t, state, label)
	require.Equal(t, "error", presentation)
}

func TestApplicationSetHealthPrioritizesErrorsAndKeepsTemplatedValues(t *testing.T) {
	object := resource("ApplicationSet", `{"goTemplate":true,"template":{"metadata":{"name":"{{.name}}"},"spec":{"project":"{{.project}}","destination":{"name":"{{.cluster}}"}}},"generators":[{"matrix":{"generators":[{"git":{"repoURL":"https://git.example.com/config","revision":"main"}},{"clusters":{}}]},"selector":{}}],"strategy":{"type":"RollingSync"},"syncPolicy":{"applicationsSync":"create-update","preserveResourcesOnDeletion":true}}`, `{"conditions":[{"type":"ResourcesUpToDate","status":"True"},{"type":"ErrorOccurred","status":"True","message":"Invalid template"}]}`)
	facts := BuildFacts("cluster-a", object)
	require.Equal(t, "{{.project}}", facts.ApplicationSet.Template.Project)
	require.Equal(t, "{{.cluster}}", facts.ApplicationSet.Template.Destination.Name)
	require.Equal(t, []Generator{{Type: "matrix"}, {Type: "git", RepoURL: "https://git.example.com/config", Revision: "main"}, {Type: "clusters"}}, facts.ApplicationSet.Generators)
	require.Equal(t, "RollingSync", facts.ApplicationSet.Strategy)
	require.True(t, *facts.ApplicationSet.PreserveResourcesOnDeletion)
	_, health, _, _ := PrimaryStatus(object)
	require.Equal(t, "Degraded", health)
	require.NoError(t, unstructured.SetNestedSlice(object.Object, []any{map[string]any{"type": "ErrorOccurred", "status": "False"}, map[string]any{"type": "ResourcesUpToDate", "status": "True"}}, "status", "conditions"))
	_, health, _, _ = PrimaryStatus(object)
	require.Equal(t, "Healthy", health)
	require.Equal(t, "ready", BuildFacts("cluster-a", object).Conditions[0].Presentation)
}

func TestAppProjectPolicyProjectionOmitsTokens(t *testing.T) {
	object := resource("AppProject", `{"description":"Production","sourceRepos":["https://git.example.com/*"],"sourceNamespaces":["team-*"],"destinations":[{"server":"https://prod.example.com","namespace":"store-*"}],"clusterResourceWhitelist":[{"group":"","kind":"Namespace"}],"namespaceResourceBlacklist":[{"group":"","kind":"Secret"}],"roles":[{"name":"reader","policies":["p, proj:production:reader, applications, get, production/*, allow"],"jwtTokens":[{"id":"private-token-id"}]}],"syncWindows":[{"kind":"deny","schedule":"0 22 * * *","duration":"8h","timeZone":"America/Denver","manualSync":true,"namespaces":["store-*"]}]}`, `{}`)
	facts := BuildFacts("cluster-a", object)
	require.Equal(t, "store-*", facts.Project.Destinations[0].Namespace)
	require.Equal(t, "Secret", facts.Project.NamespaceResourceBlacklist[0].Kind)
	require.True(t, facts.Project.SyncWindows[0].ManualSync)
	encoded, err := json.Marshal(facts)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private-token-id")
	_, _, _, ok := PrimaryStatus(object)
	require.False(t, ok, "project policy is not a health signal")
}

func TestArgoCDUnknownAndMissingStatusStayUnknown(t *testing.T) {
	app := BuildFacts("a", resource("Application", `{}`, `{}`)).Application
	require.Equal(t, "Unknown", app.Health, "new Applications must show the same unknown health in details and tables")
	require.Equal(t, "Unknown", app.Sync)

	for _, kind := range []string{"Application", "ApplicationSet"} {
		_, health, presentation, ok := PrimaryStatus(resource(kind, `{}`, `{}`))
		require.True(t, ok)
		require.Equal(t, "Unknown", health)
		require.Equal(t, "unknown", presentation)
	}
	for _, input := range []struct{ status, presentation string }{{"Progressing", "progressing"}, {"Suspended", "warning"}, {"Missing", "warning"}, {"Unknown", "unknown"}} {
		facts := BuildFacts("a", resource("Application", `{"source":{"repoURL":"repo"}}`, `{"health":{"status":"`+input.status+`"},"sync":{"status":"OutOfSync","revision":"abc"}}`))
		require.Equal(t, input.presentation, facts.Application.HealthPresentation)
		require.Equal(t, "warning", facts.Application.SyncPresentation)
		require.Equal(t, []string{"abc"}, facts.Application.Revisions)
		require.Nil(t, facts.Application.ResourceCount)
		require.Nil(t, facts.Application.ApplicationSet)
	}
	require.Nil(t, BuildFacts("a", nil))
	require.Nil(t, BuildFacts("a", resource("Workflow", `{}`, `{}`)))
}
