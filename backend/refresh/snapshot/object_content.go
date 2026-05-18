package snapshot

import (
	"context"
	"fmt"
	"strings"

	"gopkg.in/yaml.v2"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
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

// HelmContentProvider supplies Helm manifest/values for a release.
type HelmContentProvider interface {
	FetchHelmManifest(ctx context.Context, namespace, name string) (string, int, error)
	FetchHelmValues(ctx context.Context, namespace, name string) (map[string]interface{}, int, error)
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

// ObjectHelmValuesSnapshotPayload represents the Helm values payload.
type ObjectHelmValuesSnapshotPayload struct {
	ClusterMeta
	Values   map[string]interface{} `json:"values"`
	Revision int                    `json:"revision,omitempty"`
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
	identity, err := parseObjectScope(scope)
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

	manifest, revision, err := b.provider.FetchHelmManifest(ctx, namespace, name)
	if err != nil {
		return nil, err
	}

	version := uint64(0)
	if revision > 0 {
		version = uint64(revision)
	}

	return &refresh.Snapshot{
		Domain:  objectHelmManifestDomain,
		Scope:   scope,
		Version: version,
		Payload: ObjectHelmManifestSnapshotPayload{
			ClusterMeta: meta,
			Manifest:    manifest,
			Revision:    revision,
			Resources:   extractHelmManifestResourceLinks(meta.ClusterID, manifest, namespace),
		},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
		},
	}, nil
}

func extractHelmManifestResourceLinks(clusterID, manifest, defaultNamespace string) []resourcemodel.ResourceLink {
	var links []resourcemodel.ResourceLink
	seen := map[string]struct{}{}
	trimmed := strings.TrimPrefix(strings.TrimSpace(manifest), "---")
	docs := strings.Split(trimmed, "\n---")
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" || doc == "---" {
			continue
		}
		var obj map[string]interface{}
		if err := yaml.Unmarshal([]byte(doc), &obj); err != nil || obj == nil {
			continue
		}
		appendManifestResourceLinks(&links, seen, clusterID, obj, defaultNamespace)
	}
	return links
}

func appendManifestResourceLinks(
	links *[]resourcemodel.ResourceLink,
	seen map[string]struct{},
	clusterID string,
	obj map[string]interface{},
	defaultNamespace string,
) {
	kind, _ := obj["kind"].(string)
	apiVersion, _ := obj["apiVersion"].(string)
	if kind == "" {
		return
	}
	if strings.HasSuffix(kind, "List") {
		items, ok := obj["items"].([]interface{})
		if !ok {
			return
		}
		for _, item := range items {
			itemMap, ok := manifestStringMap(item)
			if !ok {
				continue
			}
			itemKind, _ := itemMap["kind"].(string)
			if itemKind == "" {
				continue
			}
			itemAPIVersion, _ := itemMap["apiVersion"].(string)
			if itemAPIVersion == "" {
				itemAPIVersion = apiVersion
			}
			appendSingleManifestResourceLink(links, seen, clusterID, itemAPIVersion, itemKind, itemMap, defaultNamespace)
		}
		return
	}
	appendSingleManifestResourceLink(links, seen, clusterID, apiVersion, kind, obj, defaultNamespace)
}

func appendSingleManifestResourceLink(
	links *[]resourcemodel.ResourceLink,
	seen map[string]struct{},
	clusterID, apiVersion, kind string,
	obj map[string]interface{},
	defaultNamespace string,
) {
	name, namespace, namespaceExplicit := manifestNameNamespace(obj, defaultNamespace)
	if name == "" {
		return
	}
	key := apiVersion + "/" + kind + "/" + namespace + "/" + name
	if _, ok := seen[key]; ok {
		return
	}
	seen[key] = struct{}{}
	link := resourcemodel.BuildHelmManifestResourceLinkWithNamespaceSource(clusterID, apiVersion, kind, namespace, name, namespaceExplicit)
	*links = append(*links, link)
}

func manifestNameNamespace(obj map[string]interface{}, defaultNamespace string) (string, string, bool) {
	metadataRaw, ok := obj["metadata"]
	if !ok {
		return "", defaultNamespace, false
	}
	metadata, ok := manifestStringMap(metadataRaw)
	if !ok {
		return "", defaultNamespace, false
	}
	name, _ := metadata["name"].(string)
	namespace := defaultNamespace
	namespaceExplicit := false
	if ns, ok := metadata["namespace"].(string); ok && ns != "" {
		namespace = ns
		namespaceExplicit = true
	}
	return name, namespace, namespaceExplicit
}

func manifestStringMap(value interface{}) (map[string]interface{}, bool) {
	switch typed := value.(type) {
	case map[string]interface{}:
		return typed, true
	case map[interface{}]interface{}:
		result := make(map[string]interface{}, len(typed))
		for key, value := range typed {
			keyString, ok := key.(string)
			if !ok {
				continue
			}
			result[keyString] = value
		}
		return result, true
	default:
		return nil, false
	}
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
			ClusterMeta: meta,
			Values:      values,
			Revision:    revision,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: len(values),
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
