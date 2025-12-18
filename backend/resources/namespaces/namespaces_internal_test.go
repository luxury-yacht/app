package namespaces

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestHasWorkloadsWithoutClient(t *testing.T) {
	service := NewService(Dependencies{
		Common: testsupport.NewResourceDependencies(),
	})

	has, unknown := service.hasWorkloads("default")
	require.False(t, has)
	require.True(t, unknown)
}
