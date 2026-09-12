package customresource

import (
	"encoding/json"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"testing"
)

func TestArgoCDNamespaceRowsAndDetailsUseTheSameProjection(t *testing.T) {
	for _, test := range []struct{ kind, resource, spec, status, health, project string }{
		{"Application", "applications", `{"project":"production","source":{"repoURL":"https://git.example.com/config"},"destination":{"server":"https://prod.example.com","namespace":"store"}}`, `{"health":{"status":"Progressing"},"sync":{"status":"OutOfSync"}}`, "Progressing", "production"},
		{"ApplicationSet", "applicationsets", `{"template":{"spec":{"project":"{{project}}","destination":{"name":"{{cluster}}"}}}}`, `{"conditions":[{"type":"ResourcesUpToDate","status":"True"}]}`, "Healthy", "{{project}}"},
		{"AppProject", "appprojects", `{"sourceRepos":["repo"],"roles":[{"name":"reader"}]}`, `{}`, "", ""},
	} {
		t.Run(test.kind, func(t *testing.T) {
			object := &unstructured.Unstructured{}
			require.NoError(t, object.UnmarshalJSON([]byte(`{"apiVersion":"argoproj.io/v1alpha1","kind":"`+test.kind+`","metadata":{"name":"shop","namespace":"team-a"},"spec":`+test.spec+`,"status":`+test.status+`}`)))
			descriptor := NewDescriptor("argoproj.io", "v1alpha1", test.resource, test.kind, test.resource+".argoproj.io")
			detail := BuildDetails("cluster-a", object, descriptor, resourcemodel.ResourceScopeNamespaced)
			row := BuildNamespaceStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, object, descriptor, "team-a")
			require.Equal(t, detail.Ref, row.Ref)
			require.Equal(t, detail.Status, row.Status)
			require.Equal(t, detail.StatusPresentation, row.StatusPresentation)
			require.Equal(t, test.health, row.ArgoCD.Health)
			require.Equal(t, test.project, row.ArgoCD.Project)
			encoded, err := json.Marshal(row.ArgoCD)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "sourceRepos")
			require.NotContains(t, string(encoded), "roles")
		})
	}
}
