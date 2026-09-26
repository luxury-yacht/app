package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func identityTestProjection(d kindspec.Descriptor, obj metav1.Object) objectmapnode.Node {
	return objectmapnode.NewNodeProjector(d.Collector.Status, d.Collector.ActionFacts, d.Edges)("cluster-a", obj)
}

func identityTestBuilder() (*ClusterIdentitiesBuilder, map[schema.GroupVersionResource][]interface{}) {
	rows := map[schema.GroupVersionResource][]interface{}{}
	allowed := domainpermissions.AllowedResources{
		"core/serviceaccounts":                          true,
		"rbac.authorization.k8s.io/rolebindings":        true,
		"rbac.authorization.k8s.io/clusterrolebindings": true,
	}
	return &ClusterIdentitiesBuilder{allowed: allowed, projectedRows: func(gvr schema.GroupVersionResource) []interface{} { return rows[gvr] }}, rows
}

func identityTestBuild(t *testing.T, b *ClusterIdentitiesBuilder, ctx context.Context, scope string) ClusterIdentitiesSnapshot {
	t.Helper()
	result, err := b.Build(WithClusterMeta(ctx, ClusterMeta{ClusterID: "cluster-a"}), "cluster-a|"+scope)
	require.NoError(t, err)
	return result.Payload.(ClusterIdentitiesSnapshot)
}

func TestClusterIdentitiesDerivesSubjectsAndBindingProvenance(t *testing.T) {
	b, rows := identityTestBuilder()
	for _, ns := range []string{"team-a", "team-b"} {
		rows[serviceaccount.Identity.GVR()] = append(rows[serviceaccount.Identity.GVR()], identityTestProjection(serviceaccount.Descriptor,
			&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: ns}}))
	}
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor, &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "view"},
		Subjects: []rbacv1.Subject{
			{Kind: "User", APIGroup: rbacv1.GroupName, Name: "alice"},
			{Kind: "User", APIGroup: rbacv1.GroupName, Name: "alice"},
			{Kind: "User", APIGroup: rbacv1.GroupName, Name: "Alice"},
			{Kind: "User", APIGroup: rbacv1.GroupName, Name: " alice "},
			{Kind: "Group", APIGroup: rbacv1.GroupName, Name: "alice"},
			{Kind: "ServiceAccount", Name: "builder", Namespace: "team-b"},
			{Kind: "ServiceAccount", Name: "missing", Namespace: "team-a"},
		},
	})}
	rows[clusterrolebinding.Identity.GVR()] = []interface{}{identityTestProjection(clusterrolebinding.Descriptor, &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "auditors"},
		Subjects:   []rbacv1.Subject{{Kind: "User", APIGroup: rbacv1.GroupName, Name: "alice"}},
	})}
	payload := identityTestBuild(t, b, context.Background(), "?limit=100")
	require.Len(t, payload.Rows, 4)
	require.Equal(t, 4, payload.Total)
	require.ElementsMatch(t, []string{"User", "Group"}, payload.Kinds)
	require.NotContains(t, payload.Capabilities.SortableFields, "namespace")
	require.NotContains(t, payload.Capabilities.FilterableFields, "namespaces")
	require.NotContains(t, payload.Capabilities.SearchableFields, "namespace")
	for _, row := range payload.Rows {
		require.Equal(t, "cluster-a", row.ClusterID)
		require.Contains(t, []string{"User", "Group"}, row.Kind)
		if row.Kind == "User" && row.Name == "alice" {
			require.Len(t, row.Bindings, 2)
			require.Equal(t, []string{"Cluster-wide", "team-a"}, row.GrantScopes)
			for _, binding := range row.Bindings {
				require.Equal(t, rbacv1.GroupName, binding.Group)
				require.Equal(t, "cluster-a", binding.ClusterID)
				require.Equal(t, "v1", binding.Version)
			}
		}
	}
	encoded, err := json.Marshal(payload.Rows)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), `"kind":"User","resource"`)
}

func TestClusterIdentitiesCoverageDoesNotDependOnServiceAccounts(t *testing.T) {
	b, rows := identityTestBuilder()
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor,
		&rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"}, Subjects: []rbacv1.Subject{{Kind: "User", Name: "alice"}}})}
	for _, state := range []refresh.ResourceReadiness{refresh.ResourceReadinessUnavailable, refresh.ResourceReadinessPending} {
		ctx := withResourceReadiness(context.Background(), map[string]refresh.ResourceReadiness{"core/serviceaccounts": state})
		payload := identityTestBuild(t, b, ctx, "?limit=10")
		require.Len(t, payload.Rows, 1)
		require.Equal(t, ResourceQueryComplete, payload.Completeness)
		require.True(t, payload.TotalIsExact)
		require.Empty(t, payload.Issues)
	}
}

func TestIdentityPanelQueryPreservesExactSubjectAndBindingRole(t *testing.T) {
	b, rows := identityTestBuilder()
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor, &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"},
		Subjects:   []rbacv1.Subject{{Kind: "User", Name: " alice "}, {Kind: "Group", Name: " alice "}, {Kind: "User", Name: "alice"}},
	})}
	scope := "?predicate.identity=" + url.QueryEscape(`["cluster-a","User"," alice "]`)
	payload := identityTestBuild(t, b, context.Background(), scope)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, " alice ", payload.Rows[0].Name)
	encoded, err := json.Marshal(payload.Rows[0].Bindings)
	require.NoError(t, err)
	var bindings []map[string]any
	require.NoError(t, json.Unmarshal(encoded, &bindings))
	require.Equal(t, map[string]any{"clusterId": "cluster-a", "group": rbacv1.GroupName, "version": "v1", "kind": "Role", "resource": "roles", "namespace": "team-a", "name": "reader"}, bindings[0]["role"])
	delete(rows, rolebinding.Identity.GVR())
	require.Empty(t, identityTestBuild(t, b, context.Background(), scope).Rows)
}

func TestIdentityPanelQueryMatchesEquivalentJSONSubjectNames(t *testing.T) {
	b, rows := identityTestBuilder()
	name := "R&D <ops>"
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor, &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"},
		Subjects: []rbacv1.Subject{
			{Kind: "Group", Name: name},
			{Kind: "Group", Name: `R\u0026D <ops>`},
			{Kind: "User", Name: name},
		},
	})}
	for _, key := range []string{
		`["cluster-a","Group","R&D <ops>"]`,
		`["cluster-a","Group","R\u0026D \u003cops\u003e"]`,
	} {
		t.Run(key, func(t *testing.T) {
			payload := identityTestBuild(t, b, context.Background(), "?predicate.identity="+url.QueryEscape(key))
			require.Len(t, payload.Rows, 1)
			require.Equal(t, name, payload.Rows[0].Name)
			require.Equal(t, "Group", payload.Rows[0].Kind)
			require.Len(t, payload.Rows[0].Bindings, 1)
			require.Equal(t, "readers", payload.Rows[0].Bindings[0].Name)
		})
	}
}

func TestIdentityPanelQueryRejectsIncompleteOrDifferentSubjectKeys(t *testing.T) {
	b, rows := identityTestBuilder()
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor, &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"},
		Subjects:   []rbacv1.Subject{{Kind: "Group", Name: "R&D <ops>"}},
	})}
	for _, key := range []string{
		`["cluster-b","Group","R&D <ops>"]`,
		`["cluster-a","User","R&D <ops>"]`,
		`["cluster-a","Group","R&D <ops> "]`,
		`["cluster-a","Group"]`,
		`["cluster-a","Group","R&D <ops>","extra"]`,
		`["cluster-a","Group",42]`,
		`not-json`,
	} {
		t.Run(key, func(t *testing.T) {
			payload := identityTestBuild(t, b, context.Background(), "?predicate.identity="+url.QueryEscape(key))
			require.Empty(t, payload.Rows)
		})
	}
}

func TestClusterIdentitiesQueriesAllSubjectsAndTracksSourceRemoval(t *testing.T) {
	b, rows := identityTestBuilder()
	subjects := make([]rbacv1.Subject, 0, 130)
	for i := 0; i < 130; i++ {
		subjects = append(subjects, rbacv1.Subject{Kind: "User", APIGroup: rbacv1.GroupName, Name: fmt.Sprintf("user-%03d", i)})
	}
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor,
		&rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "many", Namespace: "team-a"}, Subjects: subjects})}
	payload := identityTestBuild(t, b, context.Background(), "?limit=10&sort=name&sortDirection=desc&kinds=User")
	require.Equal(t, 130, payload.Total)
	require.Len(t, payload.Rows, 10)
	require.Equal(t, "user-129", payload.Rows[0].Name)
	require.NotEmpty(t, payload.Continue)
	filtered := identityTestBuild(t, b, context.Background(), "?limit=10&search=user-012")
	require.Equal(t, 1, filtered.Total)
	require.Equal(t, "user-012", filtered.Rows[0].Name)
	rows[rolebinding.Identity.GVR()] = nil
	removed := identityTestBuild(t, b, context.Background(), "?limit=10")
	require.Empty(t, removed.Rows)
	require.Zero(t, removed.Total)
}

func TestClusterIdentitiesPermissionAndReadinessStayPartial(t *testing.T) {
	b, rows := identityTestBuilder()
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor,
		&rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"}, Subjects: []rbacv1.Subject{{Kind: "User", Name: "alice", APIGroup: rbacv1.GroupName}}})}
	ctx := domainpermissions.WithAllowedResources(context.Background(), "cluster-identities", domainpermissions.AllowedResources{
		"core/serviceaccounts": true, "rbac.authorization.k8s.io/rolebindings": false, "rbac.authorization.k8s.io/clusterrolebindings": false,
	})
	denied := identityTestBuild(t, b, ctx, "?limit=10")
	require.Empty(t, denied.Rows)
	require.Equal(t, ResourceQueryPartial, denied.Completeness)
	require.False(t, denied.TotalIsExact)
	require.NotEmpty(t, denied.Issues)
	pending := identityTestBuild(t, b, withResourceReadiness(context.Background(), map[string]refresh.ResourceReadiness{
		"rbac.authorization.k8s.io/rolebindings": refresh.ResourceReadinessPending,
	}), "?limit=10")
	require.Len(t, pending.Rows, 1)
	require.Equal(t, ResourceQueryPartial, pending.Completeness)
	recovered := identityTestBuild(t, b, context.Background(), "?limit=10")
	require.Len(t, recovered.Rows, 1)
	require.Equal(t, ResourceQueryComplete, recovered.Completeness)
	_, err := b.Build(WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"}), "cluster-b|?limit=10")
	require.Error(t, err)
}

func TestClusterIdentitiesSourceVersionSpansPagesAndChangesWithBindings(t *testing.T) {
	b, rows := identityTestBuilder()
	binding := &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"},
		Subjects: []rbacv1.Subject{{Kind: "User", Name: "alice"}, {Kind: "Group", Name: "developers"}}}
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor, binding)}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	first, err := b.Build(ctx, "cluster-a|?limit=1&sort=name")
	require.NoError(t, err)
	token := first.Payload.(ClusterIdentitiesSnapshot).Continue
	require.NotEmpty(t, token)
	second, err := b.Build(ctx, "cluster-a|?limit=1&sort=name&continue="+url.QueryEscape(token))
	require.NoError(t, err)
	require.Equal(t, first.SourceVersions["object"], second.SourceVersions["object"], "pagination must keep the same raw source clock")
	require.NotEqual(t, first.Payload.(ClusterIdentitiesSnapshot).Rows[0].Name, second.Payload.(ClusterIdentitiesSnapshot).Rows[0].Name)
	binding.Subjects[0].Name = "bob"
	rows[rolebinding.Identity.GVR()] = []interface{}{identityTestProjection(rolebinding.Descriptor, binding)}
	changed, err := b.Build(ctx, "cluster-a|?limit=1&sort=name")
	require.NoError(t, err)
	require.NotEqual(t, first.SourceVersions["object"], changed.SourceVersions["object"], "an export must detect source changes between pages")
}
