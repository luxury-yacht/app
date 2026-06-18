package snapshot

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

type scopeObjectIdentity = refresh.ObjectScopeIdentity

const (
	objectDetailsDomain = "object-details"
)

// ErrObjectDetailNotImplemented is returned when the provider does not support a kind.
var ErrObjectDetailNotImplemented = errors.New("object detail provider not implemented")

// ObjectDetailProvider resolves rich object payloads for the object panel.
type ObjectDetailProvider interface {
	FetchObjectDetails(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (interface{}, string, error)
}

// ObjectLastModifiedProvider optionally resolves a "last modified" string for
// an object (the most recent spec/metadata change). The builder uses it when
// the configured provider implements it; otherwise the field is omitted.
type ObjectLastModifiedProvider interface {
	FetchObjectLastModified(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (string, error)
}

// ObjectDetailsBuilder resolves object details for the object panel.
type ObjectDetailsBuilder struct {
	provider             ObjectDetailProvider
	lastModifiedProvider ObjectLastModifiedProvider
}

// ObjectDetailsSnapshotPayload is returned to the frontend.
type ObjectDetailsSnapshotPayload struct {
	ClusterMeta
	Details interface{} `json:"details"`
	// LastModified is the relative time of the object's most recent
	// spec/metadata change (same format as Age); omitted when unavailable.
	LastModified  string                       `json:"lastModified,omitempty"`
	ResourceModel *resourcemodel.ResourceModel `json:"resourceModel,omitempty"`
}

// RegisterObjectDetailsDomain wires the object-details domain into the registry.
func RegisterObjectDetailsDomain(
	reg *domain.Registry,
	provider ObjectDetailProvider,
) error {
	if provider == nil {
		return fmt.Errorf("object detail provider is required")
	}
	builder := &ObjectDetailsBuilder{
		provider: provider,
	}
	// Last-modified resolution is optional: only wired when the provider
	// supports it, so other providers remain unaffected.
	if lm, ok := provider.(ObjectLastModifiedProvider); ok {
		builder.lastModifiedProvider = lm
	}
	return reg.Register(refresh.DomainConfig{
		Name:          objectDetailsDomain,
		BuildSnapshot: builder.Build,
	})
}

func (b *ObjectDetailsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	identity, err := parseObjectScope(scope)
	if err != nil {
		return nil, err
	}
	namespace := identity.Namespace
	gvk := identity.GVK
	kind := gvk.Kind
	name := identity.Name

	if b.provider != nil {
		if details, resourceVersion, err := b.provider.FetchObjectDetails(ctx, gvk, namespace, name); err == nil {
			lastModified := b.fetchLastModified(ctx, gvk, namespace, name)
			return b.buildSnapshot(ctx, scope, details, resourceVersion, lastModified), nil
		} else if !errors.Is(err, ErrObjectDetailNotImplemented) {
			return nil, err
		}
	}

	// Provide a minimal details payload rather than surfacing an error so the
	// frontend can render generic metadata for custom resources. Rich built-in
	// details belong in the app-level ObjectDetailProvider, not in refresh/snapshot.
	details := map[string]string{
		"kind": cases.Title(language.English, cases.NoLower).String(kind),
		"name": name,
	}
	group := gvk.Group
	version := gvk.Version
	if group != "" {
		details["apiGroup"] = group
	}
	if version != "" {
		details["apiVersion"] = version
	}
	if namespace != "" {
		details["namespace"] = namespace
	}
	lastModified := b.fetchLastModified(ctx, gvk, namespace, name)
	resourceModel := genericObjectResourceModel(ClusterMetaFromContext(ctx), gvk, namespace, name)
	return b.buildSnapshotWithModel(ctx, scope, details, "", lastModified, &resourceModel), nil
}

// fetchLastModified resolves the object's last-modified string when the
// provider supports it. It is best-effort: any error yields "" so a failed
// lookup never blocks detail rendering.
func (b *ObjectDetailsBuilder) fetchLastModified(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) string {
	if b.lastModifiedProvider == nil {
		return ""
	}
	value, err := b.lastModifiedProvider.FetchObjectLastModified(ctx, gvk, namespace, name)
	if err != nil {
		return ""
	}
	return value
}

func (b *ObjectDetailsBuilder) buildSnapshot(ctx context.Context, scope string, details interface{}, resourceVersion, lastModified string) *refresh.Snapshot {
	return b.buildSnapshotWithModel(ctx, scope, details, resourceVersion, lastModified, nil)
}

func (b *ObjectDetailsBuilder) buildSnapshotWithModel(ctx context.Context, scope string, details interface{}, resourceVersion, lastModified string, resourceModel *resourcemodel.ResourceModel) *refresh.Snapshot {
	version := parseVersion(resourceVersion)

	return &refresh.Snapshot{
		Domain:  objectDetailsDomain,
		Scope:   scope,
		Version: version,
		Payload: ObjectDetailsSnapshotPayload{
			ClusterMeta:   ClusterMetaFromContext(ctx),
			Details:       details,
			LastModified:  lastModified,
			ResourceModel: resourceModel,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
		},
	}
}

func genericObjectResourceModel(meta ClusterMeta, gvk schema.GroupVersionKind, namespace, name string) resourcemodel.ResourceModel {
	scope := resourcemodel.ResourceScopeCluster
	if namespace != "" {
		scope = resourcemodel.ResourceScopeNamespaced
	}
	return resourcemodel.ResourceModel{
		Ref: resourcemodel.ResourceRef{
			ClusterID: meta.ClusterID,
			Group:     gvk.Group,
			Version:   gvk.Version,
			Kind:      gvk.Kind,
			Namespace: namespace,
			Name:      name,
		},
		Source: resourcemodel.ResourceSourceKubernetes,
		Scope:  scope,
		Status: resourcemodel.ResourceStatusPresentation{
			Label:        "Unknown",
			State:        "unknown",
			Presentation: "unknown",
		},
	}
}

func parseObjectScope(scope string) (scopeObjectIdentity, error) {
	return refresh.ParseObjectScope(scope)
}

func parseVersion(rv string) uint64 {
	if rv == "" {
		return 0
	}
	if v, err := strconv.ParseUint(rv, 10, 64); err == nil {
		return v
	}
	return 0
}
