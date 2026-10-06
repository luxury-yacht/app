package system

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/stretchr/testify/require"
)

func TestCancelledRegistrationDoesNotPublishPermissionFallback(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	checker := permissions.NewCheckerWithReview("closed", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		cancel()
		return false, context.Canceled
	})
	registered := false
	gate := newPermissionGate(domain.New(), nil, nil, nil)
	err := registerDomains(ctx, gate, checker, []domainRegistration{{
		name: "namespaces", direct: func() error { registered = true; return nil },
	}})
	require.ErrorIs(t, err, context.Canceled)
	require.False(t, registered, "a cancelled build must not publish a fallback domain")
}
