package snapshot

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"unsafe"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
)

const helmReleaseMapScope = "cluster-a|default:helm.sh/v3:HelmRelease:shop"

// objectMapHelmTestResolver resolves every kind the map collects, the way the
// cluster's discovery does, plus any extra kinds a test needs.
func objectMapHelmTestResolver(extra ...common.ResolvedResource) stubResourceResolver {
	resolver := stubResourceResolver{}
	for _, collector := range objectMapCollectors {
		identity := collector.Identity
		resolver[schema.GroupVersionKind{Group: identity.Group, Version: identity.Version, Kind: identity.Kind}] = common.ResolvedResource{
			Group: identity.Group, Version: identity.Version, Kind: identity.Kind,
			Resource: identity.Resource, Namespaced: identity.Namespaced,
		}
	}
	for _, resolved := range extra {
		resolver[schema.GroupVersionKind{Group: resolved.Group, Version: resolved.Version, Kind: resolved.Kind}] = resolved
	}
	return resolver
}

func withHelmRelease(builder *objectMapBuilder, manifest string, extra ...common.ResolvedResource) *stubHelmContentProvider {
	provider := &stubHelmContentProvider{manifest: manifest, resolver: objectMapHelmTestResolver(extra...)}
	builder.helmManifests = provider
	return provider
}

func buildHelmReleaseMap(t *testing.T, ctx context.Context, builder *objectMapBuilder) ObjectMapSnapshotPayload {
	t.Helper()
	snap, err := builder.Build(ctx, helmReleaseMapScope)
	require.NoError(t, err)
	return snap.Payload.(ObjectMapSnapshotPayload)
}

func helmMapContext() context.Context {
	return WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})
}

func nodeKindNames(payload ObjectMapSnapshotPayload) []string {
	names := make([]string, 0, len(payload.Nodes))
	for _, node := range payload.Nodes {
		names = append(names, node.Ref.Kind+"/"+node.Ref.Name)
	}
	return names
}

// setCatalogField writes one unexported field of a seeded catalog, as the
// other catalog seeding helpers in this package do.
func setCatalogField(t *testing.T, svc *objectcatalog.Service, name string, value any) {
	t.Helper()
	field := reflect.ValueOf(svc).Elem().FieldByName(name)
	require.True(t, field.IsValid(), "catalog field %s not found", name)
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(value))
}

// seedCatalogDescriptors publishes resource descriptors on a seeded catalog
// as a completed sync does: each resource listed completely, caches ready.
func seedCatalogDescriptors(t *testing.T, svc *objectcatalog.Service, descriptors ...objectcatalog.Descriptor) {
	t.Helper()
	resources := make(map[string]objectcatalog.Descriptor, len(descriptors))
	complete := make(map[string]struct{}, len(descriptors))
	for _, desc := range descriptors {
		resources[desc.GVR().String()] = desc
		complete[desc.GVR().String()] = struct{}{}
	}
	setCatalogField(t, svc, "resources", resources)
	setCatalogField(t, svc, "completeResources", complete)
	setCatalogField(t, svc, "cachesReady", true)
}

// A release map holds exactly the objects the release's manifest names, with
// the links between them. Objects controllers created from them (the
// Deployment's ReplicaSet and Pod, the Service's EndpointSlice) are not part
// of the release and stay off the map.
func TestObjectMapHelmReleaseShowsManifestObjectsAndTheLinksBetweenThem(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	provider := withHelmRelease(builder, `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
---
apiVersion: v1
kind: Service
metadata:
  name: web
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
`)

	payload := buildHelmReleaseMap(t, helmMapContext(), builder)

	require.Equal(t, "default", provider.manifestNamespace)
	require.Equal(t, "shop", provider.manifestName)
	require.Equal(t, ObjectMapReference{
		ClusterID: "cluster-a", ClusterName: "Cluster A",
		Group: "helm.sh", Version: "v3", Kind: "HelmRelease", Namespace: "default", Name: "shop",
	}, payload.Seed)
	require.ElementsMatch(t, []string{
		"Deployment/web", "Service/web", "Ingress/web", "HorizontalPodAutoscaler/web",
	}, nodeKindNames(payload))
	deployment := nodeByKindName(t, payload, "Deployment", "web")
	require.Equal(t, ObjectMapReference{
		ClusterID: "cluster-a", ClusterName: "Cluster A", Group: "apps", Version: "v1",
		Kind: "Deployment", Resource: "deployments", Namespace: "default", Name: "web", UID: "deploy-uid",
	}, deployment.Ref)
	require.NotNil(t, deployment.Status)
	require.False(t, deployment.Missing)
	require.Len(t, payload.Edges, 2)
	assertEdge(t, payload, "Ingress", "web", "Service", "web", "routes")
	assertEdge(t, payload, "HorizontalPodAutoscaler", "web", "Deployment", "web", "scales")
	assertEdgesReferenceNodes(t, payload)
	require.Empty(t, payload.Warnings)
}

// An object the manifest names that the cluster does not have is drawn as a
// display-only card: complete identity from the manifest, no live state.
func TestObjectMapHelmReleaseShowsAbsentManifestObjectAsMissingCard(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	withHelmRelease(builder, `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-settings
`)

	payload := buildHelmReleaseMap(t, helmMapContext(), builder)

	missing := nodeByKindName(t, payload, "ConfigMap", "web-settings")
	require.True(t, missing.Missing)
	require.Equal(t, ObjectMapReference{
		ClusterID: "cluster-a", ClusterName: "Cluster A", Group: "", Version: "v1",
		Kind: "ConfigMap", Resource: "configmaps", Namespace: "default", Name: "web-settings",
	}, missing.Ref)
	require.Nil(t, missing.Status)
	require.Nil(t, missing.ActionFacts)
	require.Empty(t, missing.CreationTimestamp)
	require.False(t, nodeByKindName(t, payload, "Deployment", "web").Missing)
	require.Empty(t, payload.Warnings)
}

// Charts often name an object by an older version the cluster still serves.
// The map and catalog store it under another version, but it is the same
// object, so it shows live instead of as missing.
func TestObjectMapHelmReleaseMatchesObjectsNamedByAnotherServedVersion(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	withHelmRelease(builder, `
apiVersion: autoscaling/v1
kind: HorizontalPodAutoscaler
metadata:
  name: web
`, common.ResolvedResource{
		Group: "autoscaling", Version: "v1", Kind: "HorizontalPodAutoscaler",
		Resource: "horizontalpodautoscalers", Namespaced: true,
	})

	payload := buildHelmReleaseMap(t, helmMapContext(), builder)

	require.Len(t, payload.Nodes, 1)
	hpa := payload.Nodes[0]
	require.False(t, hpa.Missing)
	require.Equal(t, "hpa-uid", hpa.Ref.UID)
	require.Equal(t, "v2", hpa.Ref.Version)
}

// A kind the user cannot list is reported the way every map reports it, and
// its objects are never called missing: the map could not look for them.
func TestObjectMapHelmReleaseReportsDeniedKindsInsteadOfMissingObjects(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	builder.permissions = denyPermissions{denied: map[string]bool{"configmaps": true}}
	withHelmRelease(builder, `
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-settings
---
apiVersion: v1
kind: Service
metadata:
  name: web
`)

	payload := buildHelmReleaseMap(t, helmMapContext(), builder)

	require.ElementsMatch(t, []string{"Service/web"}, nodeKindNames(payload))
	require.Equal(t, []string{"skipped configmaps: insufficient permissions"}, payload.Warnings)
}

// Until a kind's data has loaded, not finding an object proves nothing.
func TestObjectMapHelmReleaseDoesNotCallObjectsMissingBeforeTheirKindLoads(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	withHelmRelease(builder, `
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-settings
`)
	ctx := withResourceReadiness(helmMapContext(), map[string]refresh.ResourceReadiness{
		permissions.ResourceKey("", "configmaps"): refresh.ResourceReadinessPending,
	})

	payload := buildHelmReleaseMap(t, ctx, builder)

	require.Empty(t, payload.Nodes)
	require.Equal(t, []string{"skipped configmaps: not loaded yet"}, payload.Warnings)
}

// Kinds the map does not collect (custom resources) come from the object
// catalog: a stored object is drawn live, an object a fully listed resource
// does not have is missing, and nothing is called missing before the catalog
// has listed the resource.
func TestObjectMapHelmReleaseUsesTheCatalogForKindsTheMapDoesNotCollect(t *testing.T) {
	certificates := common.ResolvedResource{
		Group: "cert-manager.io", Version: "v1", Kind: "Certificate", Resource: "certificates", Namespaced: true,
	}
	manifest := `
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: web-tls
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: api-tls
`
	stored := objectMapCatalogRow("cert-manager.io", "v1", "Certificate", "certificates", "default", "web-tls", "cert-uid", "2026-01-02T03:04:05Z")

	t.Run("catalog not loaded", func(t *testing.T) {
		builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset())
		withObjectMapCatalog(t, builder, stored)
		withHelmRelease(builder, manifest, certificates)

		payload := buildHelmReleaseMap(t, helmMapContext(), builder)

		require.ElementsMatch(t, []string{"Certificate/web-tls"}, nodeKindNames(payload))
		require.Equal(t, []string{"skipped certificates.cert-manager.io: not loaded yet"}, payload.Warnings)
	})

	t.Run("catalog fully listed", func(t *testing.T) {
		builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset())
		catalog := seedCatalogService(t, []objectcatalog.Summary{stored})
		seedCatalogDescriptors(t, catalog, objectcatalog.Descriptor{
			Group: "cert-manager.io", Version: "v1", Kind: "Certificate", Resource: "certificates",
			Namespaced: true, Scope: objectcatalog.ScopeNamespace,
		})
		builder.catalogService = func() *objectcatalog.Service { return catalog }
		withHelmRelease(builder, manifest, certificates)

		payload := buildHelmReleaseMap(t, helmMapContext(), builder)

		live := nodeByKindName(t, payload, "Certificate", "web-tls")
		require.False(t, live.Missing)
		require.Equal(t, ObjectMapReference{
			ClusterID: "cluster-a", ClusterName: "Cluster A", Group: "cert-manager.io", Version: "v1",
			Kind: "Certificate", Resource: "certificates", Namespace: "default", Name: "web-tls", UID: "cert-uid",
		}, live.Ref)
		require.True(t, nodeByKindName(t, payload, "Certificate", "api-tls").Missing)
		require.Empty(t, payload.Warnings)
	})

	t.Run("catalog denied the resource", func(t *testing.T) {
		builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset())
		catalog := seedCatalogService(t, []objectcatalog.Summary{stored})
		seedCatalogDescriptors(t, catalog, objectcatalog.Descriptor{
			Group: "cert-manager.io", Version: "v1", Kind: "Certificate", Resource: "certificates",
			Namespaced: true, Scope: objectcatalog.ScopeNamespace,
		})
		denyCatalogResource(t, catalog, "certificates.cert-manager.io")
		builder.catalogService = func() *objectcatalog.Service { return catalog }
		withHelmRelease(builder, manifest, certificates)

		payload := buildHelmReleaseMap(t, helmMapContext(), builder)

		require.ElementsMatch(t, []string{"Certificate/web-tls"}, nodeKindNames(payload))
		require.Equal(t, []string{"skipped certificates.cert-manager.io: insufficient permissions"}, payload.Warnings)
	})
}

// denyCatalogResource publishes a sync that found listing the resource
// forbidden, so the resource is denied rather than completely listed.
func denyCatalogResource(t *testing.T, svc *objectcatalog.Service, resource string) {
	t.Helper()
	setCatalogField(t, svc, "deniedResources", map[string]struct{}{resource: {}})
	setCatalogField(t, svc, "completeResources", map[string]struct{}{})
}

// A manifest object whose API the cluster no longer serves cannot be looked
// up: Kubernetes may still hold it under another API. It is reported, not
// drawn as missing.
func TestObjectMapHelmReleaseReportsObjectsWhoseAPIIsNotServed(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	withHelmRelease(builder, `
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: web
`)

	payload := buildHelmReleaseMap(t, helmMapContext(), builder)

	require.Empty(t, payload.Nodes)
	require.Equal(t, []string{"skipped Ingress default/web: extensions/v1beta1 is not served by the cluster"}, payload.Warnings)
}

// Objects in a namespace outside the cluster's namespace scope are never
// collected, so the map cannot tell whether they exist.
func TestObjectMapHelmReleaseReportsObjectsOutsideTheNamespaceScope(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	builder.allowedNamespaces = []string{"default"}
	withHelmRelease(builder, `
apiVersion: v1
kind: ConfigMap
metadata:
  name: shared
  namespace: platform
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: other
  namespace: platform
`)

	payload := buildHelmReleaseMap(t, helmMapContext(), builder)

	require.Empty(t, payload.Nodes)
	require.Equal(t, []string{"skipped namespace platform: outside the cluster's namespace scope"}, payload.Warnings)
}

// A release larger than the node cap is truncated, and linked objects are
// kept before isolated ones (here a missing ConfigMap, whose kind sorts first).
func TestObjectMapHelmReleaseTruncatesAtTheNodeCap(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objectMapFixtureObjects()...))
	withHelmRelease(builder, `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-settings
`)

	snap, err := builder.Build(helmMapContext(), helmReleaseMapScope+"?maxNodes=2")
	require.NoError(t, err)
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	require.True(t, payload.Truncated)
	require.Equal(t, 2, payload.MaxNodes)
	require.ElementsMatch(t, []string{"Deployment/web", "HorizontalPodAutoscaler/web"}, nodeKindNames(payload))
	assertEdge(t, payload, "HorizontalPodAutoscaler", "web", "Deployment", "web", "scales")
}

type failingHelmManifestProvider struct{ err error }

func (p failingHelmManifestProvider) FetchHelmManifest(context.Context, string, string) (string, int, error) {
	return "", 0, p.err
}

func (p failingHelmManifestProvider) FetchHelmValues(context.Context, string, string) (helm.HelmReleaseValues, int, error) {
	return helm.HelmReleaseValues{}, 0, p.err
}

// A release that cannot be read fails the map build with the read error, so
// the Map tab shows it instead of an empty map.
func TestObjectMapHelmReleaseFailsWhenTheReleaseCannotBeRead(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset())
	readErr := errors.New("release shop not found")
	builder.helmManifests = failingHelmManifestProvider{err: readErr}

	_, err := builder.Build(helmMapContext(), helmReleaseMapScope)

	require.ErrorIs(t, err, readErr)
}

// Every Helm release lives in a namespace, and manifest objects without an
// explicit namespace belong to it; a scope without one is rejected rather
// than guessed.
func TestObjectMapHelmReleaseRequiresTheReleaseNamespace(t *testing.T) {
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset())
	provider := withHelmRelease(builder, "")

	_, err := builder.Build(helmMapContext(), "cluster-a|__cluster__:helm.sh/v3:HelmRelease:shop")

	require.Error(t, err)
	require.Empty(t, provider.manifestName, "the release must not be read without its namespace")
}
