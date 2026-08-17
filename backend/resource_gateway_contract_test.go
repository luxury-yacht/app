package backend

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResourceGatewayUsesLeafRefreshProjectionWithoutRefreshCallbacks(t *testing.T) {
	projectionType := reflect.TypeOf((*refreshResourceProjection)(nil))
	for _, value := range []any{resourceGatewayDependencies{}, ResourceGateway{}} {
		valueType := reflect.TypeOf(value)
		field, found := valueType.FieldByName("refreshProjection")
		require.Truef(t, found, "%s must receive the leaf refresh projection", valueType.Name())
		require.Equal(t, projectionType, field.Type)
		for _, callback := range []string{
			"retryTelemetry", "retryTelemetryFn",
			"catalogServiceForCluster", "catalogServiceForClusterFn",
			"catalogEntries", "catalogEntriesFn",
			"catalogTelemetry", "catalogTelemetryFn",
		} {
			_, found := valueType.FieldByName(callback)
			require.Falsef(t, found, "%s retains refresh callback %s", valueType.Name(), callback)
		}
	}
}
