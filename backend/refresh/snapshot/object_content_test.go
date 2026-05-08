package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractHelmManifestResourceLinksRespectsScope(t *testing.T) {
	manifest := `
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: reader
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
---
apiVersion: databases.example.com/v1alpha1
kind: Database
metadata:
  name: orders
---
`

	links := extractHelmManifestResourceLinks("cluster-a", manifest, "release-ns")

	require.Len(t, links, 3)
	require.NotNil(t, links[0].Ref)
	require.Equal(t, "ClusterRole", links[0].Ref.Kind)
	require.Empty(t, links[0].Ref.Namespace)

	require.NotNil(t, links[1].Ref)
	require.Equal(t, "ConfigMap", links[1].Ref.Kind)
	require.Equal(t, "release-ns", links[1].Ref.Namespace)

	require.Nil(t, links[2].Ref)
	require.NotNil(t, links[2].Display)
	require.Equal(t, "Database", links[2].Display.Kind)
	require.Equal(t, "release-ns", links[2].Display.Namespace)
}
