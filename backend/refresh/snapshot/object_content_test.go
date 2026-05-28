package snapshot

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type stubObjectYAMLProvider struct {
	yaml      string
	gvk       schema.GroupVersionKind
	namespace string
	name      string
}

func (s *stubObjectYAMLProvider) FetchObjectYAML(_ context.Context, gvk schema.GroupVersionKind, namespace, name string) (string, error) {
	s.gvk = gvk
	s.namespace = namespace
	s.name = name
	return s.yaml, nil
}

type stubHelmContentProvider struct {
	manifest          string
	manifestRevision  int
	manifestNamespace string
	manifestName      string
	values            map[string]interface{}
	valuesRevision    int
	valuesNamespace   string
	valuesName        string
}

type stubResourceResolver map[schema.GroupVersionKind]common.ResolvedResource

func (r stubResourceResolver) ResolveResourceForGVK(_ context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	resolved, ok := r[gvk]
	return resolved, ok, nil
}

func (s *stubHelmContentProvider) FetchHelmManifest(_ context.Context, namespace, name string) (string, int, error) {
	s.manifestNamespace = namespace
	s.manifestName = name
	return s.manifest, s.manifestRevision, nil
}

func (s *stubHelmContentProvider) FetchHelmValues(_ context.Context, namespace, name string) (map[string]interface{}, int, error) {
	s.valuesNamespace = namespace
	s.valuesName = name
	return s.values, s.valuesRevision, nil
}

func TestObjectYAMLBuilderUsesFullObjectScopeAndClusterMeta(t *testing.T) {
	provider := &stubObjectYAMLProvider{yaml: "kind: ConfigMap\nmetadata:\n  name: settings\n"}
	builder := &ObjectYAMLBuilder{provider: provider}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snapshot, err := builder.Build(ctx, "cluster-a|default:/v1:ConfigMap:settings")
	require.NoError(t, err)

	require.Equal(t, schema.GroupVersionKind{Group: "", Version: "v1", Kind: "ConfigMap"}, provider.gvk)
	require.Equal(t, "default", provider.namespace)
	require.Equal(t, "settings", provider.name)
	require.Equal(t, objectYAMLDdomain, snapshot.Domain)
	require.Equal(t, uint64(0), snapshot.Version)
	require.Equal(t, 1, snapshot.Stats.ItemCount)

	payload := snapshot.Payload.(ObjectYAMLSnapshotPayload)
	require.Equal(t, "cluster-a", payload.ClusterID)
	require.Equal(t, "Cluster A", payload.ClusterName)
	require.Equal(t, provider.yaml, payload.YAML)
}

func TestObjectHelmManifestBuilderUsesReleaseScopeAndResourceLinks(t *testing.T) {
	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: explicit
`
	provider := &stubHelmContentProvider{manifest: manifest, manifestRevision: 12}
	resolver := stubResourceResolver{
		{Group: "apps", Version: "v1", Kind: "Deployment"}: {
			Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespaced: true,
		},
		{Group: "", Version: "v1", Kind: "Service"}: {
			Group: "", Version: "v1", Kind: "Service", Resource: "services", Namespaced: true,
		},
	}
	builder := &ObjectHelmManifestBuilder{provider: provider, resolver: resolver}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snapshot, err := builder.Build(ctx, "cluster-a|apps:checkout")
	require.NoError(t, err)

	require.Equal(t, "apps", provider.manifestNamespace)
	require.Equal(t, "checkout", provider.manifestName)
	require.Equal(t, objectHelmManifestDomain, snapshot.Domain)
	require.Equal(t, uint64(12), snapshot.Version)

	payload := snapshot.Payload.(ObjectHelmManifestSnapshotPayload)
	require.Equal(t, "cluster-a", payload.ClusterID)
	require.Equal(t, manifest, payload.Manifest)
	require.Equal(t, 12, payload.Revision)
	require.Len(t, payload.Resources, 2)
	require.NotNil(t, payload.Resources[0].Ref)
	require.Equal(t, "cluster-a", payload.Resources[0].Ref.ClusterID)
	require.Equal(t, "apps", payload.Resources[0].Ref.Group)
	require.Equal(t, "v1", payload.Resources[0].Ref.Version)
	require.Equal(t, "Deployment", payload.Resources[0].Ref.Kind)
	require.Equal(t, "apps", payload.Resources[0].Ref.Namespace)
	require.Equal(t, "api", payload.Resources[0].Ref.Name)
	require.NotNil(t, payload.Resources[1].Ref)
	require.Equal(t, "explicit", payload.Resources[1].Ref.Namespace)
}

func TestObjectHelmValuesBuilderUsesReleaseScopeAndCountsValues(t *testing.T) {
	provider := &stubHelmContentProvider{
		values:         map[string]interface{}{"replicas": 2, "image": "example/api:1.0"},
		valuesRevision: 7,
	}
	builder := &ObjectHelmValuesBuilder{provider: provider}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snapshot, err := builder.Build(ctx, "cluster-a|apps:checkout")
	require.NoError(t, err)

	require.Equal(t, "apps", provider.valuesNamespace)
	require.Equal(t, "checkout", provider.valuesName)
	require.Equal(t, objectHelmValuesDomain, snapshot.Domain)
	require.Equal(t, uint64(7), snapshot.Version)
	require.Equal(t, 2, snapshot.Stats.ItemCount)

	payload := snapshot.Payload.(ObjectHelmValuesSnapshotPayload)
	require.Equal(t, "cluster-a", payload.ClusterID)
	require.Equal(t, 7, payload.Revision)
	require.Equal(t, provider.values, payload.Values)
}

func TestParseHelmScopeHandlesClusterPrefixAndClusterScopedReleases(t *testing.T) {
	namespace, name, err := parseHelmScope("cluster-a|apps:checkout")
	require.NoError(t, err)
	require.Equal(t, "apps", namespace)
	require.Equal(t, "checkout", name)

	namespace, name, err = parseHelmScope("cluster-a|__cluster__:system-release")
	require.NoError(t, err)
	require.Empty(t, namespace)
	require.Equal(t, "system-release", name)

	_, _, err = parseHelmScope("cluster-a|apps:")
	require.Error(t, err)
}

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

	resolver := stubResourceResolver{
		{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole"}: {
			Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole", Resource: "clusterroles", Namespaced: false,
		},
		{Group: "", Version: "v1", Kind: "ConfigMap"}: {
			Group: "", Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespaced: true,
		},
	}
	links := extractHelmManifestResourceLinks(context.Background(), resolver, "cluster-a", manifest, "release-ns")

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
