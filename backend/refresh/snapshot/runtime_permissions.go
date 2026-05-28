package snapshot

import (
	"context"

	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
)

func runtimeResourceAllowed(ctx context.Context, domainName, group, resource string) bool {
	allowed, ok := domainpermissions.AllowedResourcesFromContext(ctx, domainName)
	if !ok {
		return true
	}
	return allowed.Allows(group, resource)
}
