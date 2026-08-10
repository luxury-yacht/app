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
	FetchObjectDetails(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (interface{}, error)
}

// ObjectDeletionMetadata carries deletion fields shared by every Kubernetes
// object. Namespace spec finalizers and deletion conditions remain owned by the
// Namespace detail DTO because they are not metadata fields.
type ObjectDeletionMetadata struct {
	DeletionTimestamp string   `json:"deletionTimestamp"`
	Finalizers        []string `json:"finalizers,omitempty"`
}

// ObjectHeaderMetadata carries the kind-agnostic fields the object panel
// derives from one live-object read.
type ObjectHeaderMetadata struct {
	// CreationTimestamp is the object's creation time in RFC3339 UTC (the same
	// format the object catalog stores), or "" when unavailable. It is delivered
	// raw so the frontend formats it with the same Age formatter the Browse table
	// uses, keeping the two surfaces byte-identical.
	CreationTimestamp string
	// LastModified is the relative time of the object's most recent spec/metadata
	// change (already formatted), or "" when unavailable.
	LastModified string
	// ResourceVersion is the live object's metadata.resourceVersion, or "" when
	// unavailable. It is the object's source clock: the object-details snapshot's
	// Version (and thus the source-version ETag) is derived from it, so the panel
	// re-renders whenever the object changes (e.g. a Deployment's image tag). Read
	// from the same single live-object read as the other header fields.
	ResourceVersion string
	// Deletion is present once metadata.deletionTimestamp is set.
	Deletion *ObjectDeletionMetadata
}

// ObjectHeaderMetadataProvider optionally resolves the header metadata for an
// object. The builder uses it when the configured provider implements it;
// otherwise the fields are omitted.
type ObjectHeaderMetadataProvider interface {
	FetchObjectHeaderMetadata(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) (ObjectHeaderMetadata, error)
}

// ObjectDetailsBuilder resolves object details for the object panel.
type ObjectDetailsBuilder struct {
	provider         ObjectDetailProvider
	metadataProvider ObjectHeaderMetadataProvider
}

// ObjectDetailsSnapshotPayload is returned to the frontend.
type ObjectDetailsSnapshotPayload struct {
	ClusterMeta
	Details interface{} `json:"details"`
	// CreationTimestamp is the object's creation time (RFC3339 UTC); the
	// frontend formats it into the Age field for every kind. Omitted when
	// unavailable.
	CreationTimestamp string `json:"creationTimestamp,omitempty"`
	// LastModified is the relative time of the object's most recent
	// spec/metadata change (same format as Age); omitted when unavailable.
	LastModified string `json:"lastModified,omitempty"`
	// Deletion is present while the live object is terminating.
	Deletion      *ObjectDeletionMetadata      `json:"deletion,omitempty"`
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
	// Header metadata (creation + last-modified) resolution is optional: only
	// wired when the provider supports it, so other providers remain unaffected.
	if hm, ok := provider.(ObjectHeaderMetadataProvider); ok {
		builder.metadataProvider = hm
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
		if details, err := b.provider.FetchObjectDetails(ctx, gvk, namespace, name); err == nil {
			meta := b.fetchHeaderMetadata(ctx, gvk, namespace, name)
			return b.buildSnapshot(ctx, scope, details, meta), nil
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
		details["group"] = group
	}
	if version != "" {
		details["version"] = version
	}
	if namespace != "" {
		details["namespace"] = namespace
	}
	meta := b.fetchHeaderMetadata(ctx, gvk, namespace, name)
	resourceModel := genericObjectResourceModel(ClusterMetaFromContext(ctx), gvk, namespace, name)
	return b.buildSnapshotWithModel(ctx, scope, details, meta, &resourceModel), nil
}

// fetchHeaderMetadata resolves the object's header metadata (creation +
// last-modified) when the provider supports it. It is best-effort: any error
// yields the zero value so a failed lookup never blocks detail rendering.
func (b *ObjectDetailsBuilder) fetchHeaderMetadata(ctx context.Context, gvk schema.GroupVersionKind, namespace, name string) ObjectHeaderMetadata {
	if b.metadataProvider == nil {
		return ObjectHeaderMetadata{}
	}
	value, err := b.metadataProvider.FetchObjectHeaderMetadata(ctx, gvk, namespace, name)
	if err != nil {
		return ObjectHeaderMetadata{}
	}
	return value
}

func (b *ObjectDetailsBuilder) buildSnapshot(ctx context.Context, scope string, details interface{}, meta ObjectHeaderMetadata) *refresh.Snapshot {
	return b.buildSnapshotWithModel(ctx, scope, details, meta, nil)
}

func (b *ObjectDetailsBuilder) buildSnapshotWithModel(ctx context.Context, scope string, details interface{}, meta ObjectHeaderMetadata, resourceModel *resourcemodel.ResourceModel) *refresh.Snapshot {
	// The object's resourceVersion is the source clock: a change to the object
	// (new image tag → new resourceVersion) changes the snapshot Version and thus
	// the source-version ETag, so the panel refreshes instead of getting a 304.
	version := parseVersion(meta.ResourceVersion)

	return &refresh.Snapshot{
		Domain:  objectDetailsDomain,
		Scope:   scope,
		Version: version,
		Payload: ObjectDetailsSnapshotPayload{
			ClusterMeta:       ClusterMetaFromContext(ctx),
			Details:           details,
			CreationTimestamp: meta.CreationTimestamp,
			LastModified:      meta.LastModified,
			Deletion:          meta.Deletion,
			ResourceModel:     resourceModel,
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
