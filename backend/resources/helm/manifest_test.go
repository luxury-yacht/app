/*
 * backend/resources/helm/manifest_test.go
 *
 * Tests for release manifest parsing shared by the Details tab resources list
 * and the Manifest/Map refresh domains.
 */

package helm

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestParseManifestResourcesBuildsUniqueList(t *testing.T) {
	manifest := `
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: staging
---
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: Service
    metadata:
      name: web
      namespace: prod
  - apiVersion: v1
    kind: Service
    metadata:
      name: web
      namespace: prod
---
`

	require.Equal(t, []resourcemodel.HelmManifestResource{
		{APIVersion: "v1", Kind: "ConfigMap", Namespace: "default", Name: "app-config"},
		{APIVersion: "apps/v1", Kind: "Deployment", Namespace: "staging", Name: "web", NamespaceExplicit: true},
		{APIVersion: "v1", Kind: "Service", Namespace: "prod", Name: "web", NamespaceExplicit: true},
	}, ParseManifestResources(manifest, "default"))
}

func TestParseManifestResourcesIgnoresInvalidDocuments(t *testing.T) {
	manifest := `
---
kind: ""
metadata:
  name: ignored
---
apiVersion: v1
kind: Secret
metadata:
  namespace: team-a
  name: credentials
data: {}
---
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: Service
    metadata: not-a-map
  - apiVersion: v1
    kind: Service
    metadata:
      name: svc
      namespace: other
---
`

	require.Equal(t, []resourcemodel.HelmManifestResource{
		{APIVersion: "v1", Kind: "Secret", Namespace: "team-a", Name: "credentials", NamespaceExplicit: true},
		{APIVersion: "v1", Kind: "Service", Namespace: "other", Name: "svc", NamespaceExplicit: true},
	}, ParseManifestResources(manifest, "team-default"))
}

// Two CRDs sharing kind/name/namespace from different operator groups must stay
// distinct; a Kind+namespace+name dedupe key would collapse them and the panel
// could not open the right one.
func TestParseManifestResourcesDisambiguatesCollidingCRDs(t *testing.T) {
	manifest := `
---
apiVersion: rds.services.k8s.aws/v1alpha1
kind: DBCluster
metadata:
  name: primary
  namespace: data
---
apiVersion: postgresql.cnpg.io/v1
kind: DBCluster
metadata:
  name: primary
  namespace: data
---
`

	require.Equal(t, []resourcemodel.HelmManifestResource{
		{APIVersion: "rds.services.k8s.aws/v1alpha1", Kind: "DBCluster", Namespace: "data", Name: "primary", NamespaceExplicit: true},
		{APIVersion: "postgresql.cnpg.io/v1", Kind: "DBCluster", Namespace: "data", Name: "primary", NamespaceExplicit: true},
	}, ParseManifestResources(manifest, "default"))
}

func TestParseManifestResourcesFlattensListsAndSkipsUnusableEntries(t *testing.T) {
	manifest := `
---
this: [is invalid
---
apiVersion: v1
kind: List
items:
  - scalar-item
  - kind: ConfigMap
    metadata:
      name: pre-install-config
      annotations:
        helm.sh/hook: pre-install
  - apiVersion: apps/v1
    kind: Deployment
    metadata:
      name: application
  - apiVersion: v1
    metadata:
      name: missing-kind
---
apiVersion: v1
kind: List
items: not-a-list
`

	require.Equal(t, []resourcemodel.HelmManifestResource{
		{APIVersion: "v1", Kind: "ConfigMap", Namespace: "release-ns", Name: "pre-install-config"},
		{APIVersion: "apps/v1", Kind: "Deployment", Namespace: "release-ns", Name: "application"},
	}, ParseManifestResources(manifest, "release-ns"))
}

func TestExtractNameNamespaceSupportsInterfaceMap(t *testing.T) {
	obj := map[string]interface{}{
		"metadata": map[interface{}]interface{}{
			"name":      "demo",
			"namespace": "custom-ns",
		},
	}

	name, ns, explicit := extractNameNamespace(obj, "fallback")
	require.Equal(t, "demo", name)
	require.Equal(t, "custom-ns", ns)
	require.True(t, explicit)

	name, ns, explicit = extractNameNamespace(map[string]interface{}{}, "fallback")
	require.Equal(t, "", name)
	require.Equal(t, "fallback", ns)
	require.False(t, explicit)
}
