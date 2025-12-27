package snapshot

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	objectYAMLDdomain        = "object-yaml"
	objectHelmManifestDomain = "object-helm-manifest"
	objectHelmValuesDomain   = "object-helm-values"
)

// ObjectYAMLProvider supplies rendered YAML for an object scope.
type ObjectYAMLProvider interface {
	FetchObjectYAML(ctx context.Context, kind, namespace, name string) (string, error)
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
	Manifest string `json:"manifest"`
	Revision int    `json:"revision,omitempty"`
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
	namespace, kind, name, err := parseObjectScope(scope)
	if err != nil {
		return nil, err
	}
	meta := CurrentClusterMeta()

	yaml, err := b.provider.FetchObjectYAML(ctx, kind, namespace, name)
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
	meta := CurrentClusterMeta()

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
		},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
		},
	}, nil
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
	meta := CurrentClusterMeta()

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
	if namespace == clusterScopeToken {
		namespace = ""
	}
	name := parts[1]
	if name == "" {
		return "", "", fmt.Errorf("helm release name missing in scope %q", scope)
	}
	return namespace, name, nil
}
