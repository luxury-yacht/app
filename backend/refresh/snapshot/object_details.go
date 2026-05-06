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

// ObjectDetailsBuilder resolves object details for the object panel.
type ObjectDetailsBuilder struct {
	provider ObjectDetailProvider
}

// ObjectDetailsSnapshotPayload is returned to the frontend.
type ObjectDetailsSnapshotPayload struct {
	ClusterMeta
	Details interface{} `json:"details"`
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
			return b.buildSnapshot(ctx, scope, details, resourceVersion), nil
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
	if namespace != "" {
		details["namespace"] = namespace
	}
	return b.buildSnapshot(ctx, scope, details, ""), nil
}

func (b *ObjectDetailsBuilder) buildSnapshot(ctx context.Context, scope string, details interface{}, resourceVersion string) *refresh.Snapshot {
	version := parseVersion(resourceVersion)

	return &refresh.Snapshot{
		Domain:  objectDetailsDomain,
		Scope:   scope,
		Version: version,
		Payload: ObjectDetailsSnapshotPayload{
			ClusterMeta: ClusterMetaFromContext(ctx),
			Details:     details,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: 1,
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
