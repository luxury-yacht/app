package snapshot

import (
	"context"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// RegisterPermissionDeniedDomain registers a domain that always returns a permission denied error.
func RegisterPermissionDeniedDomain(reg *domain.Registry, name string, resource string) error {
	if reg == nil {
		return nil
	}
	return reg.Register(refresh.DomainConfig{
		Name:             name,
		PermissionDenied: true,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return nil, refresh.NewPermissionDeniedError(name, resource)
		},
	})
}
