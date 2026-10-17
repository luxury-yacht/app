package snapshot

import (
	"context"
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/helm"
)

const (
	objectYAMLDdomain        = "object-yaml"
	objectHelmManifestDomain = "object-helm-manifest"
	objectHelmValuesDomain   = "object-helm-values"
)

// ObjectYAMLProvider supplies rendered YAML for an object scope. The
// GroupVersionKind carries the caller-requested identity and must include
// group/version so colliding kinds stay disambiguated.
type ObjectYAMLProvider interface {
	FetchObjectYAML(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (string, error)
}

// HelmManifestProvider supplies a release's rendered manifest and revision.
type HelmManifestProvider interface {
	FetchHelmManifest(ctx context.Context, namespace, name string) (string, int, error)
}

// HelmContentProvider supplies Helm manifest/values for a release.
type HelmContentProvider interface {
	HelmManifestProvider
	FetchHelmValues(ctx context.Context, namespace, name string) (helm.HelmReleaseValues, int, error)
}

type HelmResourceResolverProvider interface {
	ResourceResolver(context.Context) common.ResourceResolver
}

// ObjectYAMLSnapshotPayload represents the YAML payload.
type ObjectYAMLSnapshotPayload struct {
	ClusterMeta
	YAML string `json:"yaml"`
}

// ObjectHelmManifestSnapshotPayload represents the Helm manifest payload.
type ObjectHelmManifestSnapshotPayload struct {
	ClusterMeta
	Manifest  string                       `json:"manifest"`
	Revision  int                          `json:"revision,omitempty"`
	Resources []resourcemodel.ResourceLink `json:"resources,omitempty"`
}

// ObjectHelmValuesSnapshotPayload carries the Values tab's three views of one
// release revision.
type ObjectHelmValuesSnapshotPayload struct {
	ClusterMeta
	Defaults  map[string]interface{} `json:"defaults"`
	Merged    map[string]interface{} `json:"merged"`
	Overrides map[string]interface{} `json:"overrides"`
	// SubchartPaths locate subchart values, so the Values tab can mark the
	// subchart copies Helm makes of overridden `global` values.
	SubchartPaths [][]string `json:"subchartPaths"`
	Revision      int        `json:"revision,omitempty"`
}

// RegisterObjectYAMLDdomain wires the YAML domain.
func RegisterObjectYAMLDdomain(reg *domain.Registry, provider ObjectYAMLProvider) error {
	if provider == nil {
		return fmt.Errorf("object yaml provider is nil")
	}
	builder := &ObjectYAMLBuilder{provider: provider}
	return reg.Register(refresh.DomainConfig{
		Name:          objectYAMLDdomain,
		BuildSnapshot: builder.Build,
	})
}

// RegisterObjectHelmManifestDomain wires the Helm manifest domain.
func RegisterObjectHelmManifestDomain(reg *domain.Registry, provider HelmContentProvider) error {
	if provider == nil {
		return fmt.Errorf("helm content provider is nil")
	}
	builder := &ObjectHelmManifestBuilder{provider: provider}
	return reg.Register(refresh.DomainConfig{
		Name:          objectHelmManifestDomain,
		BuildSnapshot: builder.Build,
	})
}

// RegisterObjectHelmValuesDomain wires the Helm values domain.
func RegisterObjectHelmValuesDomain(reg *domain.Registry, provider HelmContentProvider) error {
	if provider == nil {
		return fmt.Errorf("helm content provider is nil")
	}
	builder := &ObjectHelmValuesBuilder{provider: provider}
	return reg.Register(refresh.DomainConfig{
		Name:          objectHelmValuesDomain,
		BuildSnapshot: builder.Build,
	})
}

// ObjectYAMLBuilder builds YAML snapshots.
type ObjectYAMLBuilder struct {
	provider ObjectYAMLProvider
}

func (b *ObjectYAMLBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	identity, err := refresh.ParseObjectScope(scope)
	if err != nil {
		return nil, err
	}
	meta := ClusterMetaFromContext(ctx)

	yaml, err := b.provider.FetchObjectYAML(ctx, identity.GVK, identity.Namespace, identity.Name)
	if err != nil {
		return nil, err
	}

	return &refresh.Snapshot{
		Domain:  objectYAMLDdomain,
		Scope:   scope,
		Version: 0,
		Payload: ObjectYAMLSnapshotPayload{ClusterMeta: meta, YAML: yaml},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
		},
	}, nil
}

// ObjectHelmManifestBuilder builds manifest snapshots.
type ObjectHelmManifestBuilder struct {
	provider HelmContentProvider
}

func (b *ObjectHelmManifestBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	namespace, name, err := parseHelmScope(scope)
	if err != nil {
		return nil, err
	}
	meta := ClusterMetaFromContext(ctx)

	release, err := fetchHelmManifestResources(ctx, b.provider, meta.ClusterID, namespace, name)
	if err != nil {
		return nil, err
	}

	version := uint64(0)
	if release.revision > 0 {
		version = uint64(release.revision)
	}

	return &refresh.Snapshot{
		Domain:  objectHelmManifestDomain,
		Scope:   scope,
		Version: version,
		Payload: ObjectHelmManifestSnapshotPayload{
			ClusterMeta: meta,
			Manifest:    release.manifest,
			Revision:    release.revision,
			Resources:   release.resources,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
		},
	}, nil
}

// helmManifestResources is one read of a release's manifest with the
// identities of the objects it names.
type helmManifestResources struct {
	manifest  string
	revision  int
	resources []resourcemodel.ResourceLink
}

// fetchHelmManifestResources reads a release's manifest and resolves each
// object it names through the provider's resource resolver, when it has one.
func fetchHelmManifestResources(ctx context.Context, provider HelmManifestProvider, clusterID, namespace, name string) (helmManifestResources, error) {
	manifest, revision, err := provider.FetchHelmManifest(ctx, namespace, name)
	if err != nil {
		return helmManifestResources{}, err
	}
	var resolver common.ResourceResolver
	if resolverProvider, ok := provider.(HelmResourceResolverProvider); ok {
		resolver = resolverProvider.ResourceResolver(ctx)
	}
	return helmManifestResources{
		manifest:  manifest,
		revision:  revision,
		resources: extractHelmManifestResourceLinks(ctx, resolver, clusterID, manifest, namespace),
	}, nil
}

func extractHelmManifestResourceLinks(ctx context.Context, resolver common.ResourceResolver, clusterID, manifest, defaultNamespace string) []resourcemodel.ResourceLink {
	var links []resourcemodel.ResourceLink
	for _, resource := range helm.ParseManifestResources(manifest, defaultNamespace) {
		links = append(links, resourcemodel.BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(ctx, resolver, clusterID, resource))
	}
	return links
}

// ObjectHelmValuesBuilder builds values snapshots.
type ObjectHelmValuesBuilder struct {
	provider HelmContentProvider
}

func (b *ObjectHelmValuesBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	namespace, name, err := parseHelmScope(scope)
	if err != nil {
		return nil, err
	}
	meta := ClusterMetaFromContext(ctx)

	values, revision, err := b.provider.FetchHelmValues(ctx, namespace, name)
	if err != nil {
		return nil, err
	}

	version := uint64(0)
	if revision > 0 {
		version = uint64(revision)
	}

	return &refresh.Snapshot{
		Domain:  objectHelmValuesDomain,
		Scope:   scope,
		Version: version,
		Payload: ObjectHelmValuesSnapshotPayload{
			ClusterMeta:   meta,
			Defaults:      values.Defaults,
			Merged:        values.Merged,
			Overrides:     values.Overrides,
			SubchartPaths: values.SubchartPaths,
			Revision:      revision,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
		},
	}, nil
}

func parseHelmScope(scope string) (string, string, error) {
	if strings.TrimSpace(scope) == "" {
		return "", "", fmt.Errorf("helm scope is required")
	}
	_, trimmed := refresh.SplitClusterScope(scope)
	parts := strings.SplitN(trimmed, ":", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid helm scope %q", trimmed)
	}
	namespace := parts[0]
	if namespace == refresh.ObjectClusterScopeToken {
		namespace = ""
	}
	name := parts[1]
	if name == "" {
		return "", "", fmt.Errorf("helm release name missing in scope %q", scope)
	}
	return namespace, name, nil
}
