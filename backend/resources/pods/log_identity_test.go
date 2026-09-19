package pods

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes/fake"
)

func TestFetchContainerLogsRejectsSameKindWithDifferentAPIIdentity(t *testing.T) {
	for _, scope := range []string{
		"cluster-a|default:example.io/v1:Pod:demo",
		"cluster-a|default:/v2:Pod:demo",
		"cluster-a|default:example.io/v1:Deployment:demo",
		"cluster-a|default:apps/v1beta1:Deployment:demo",
		"cluster-a|default:apps/v1:Job:demo",
		"cluster-a|default:batch/v1beta1:CronJob:demo",
	} {
		for _, matchNone := range []bool{false, true} {
			t.Run(scope, func(t *testing.T) {
				client := fake.NewClientset()
				service := NewService(common.Dependencies{KubernetesClient: client})
				response := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{
					Scope: scope, MatchNone: matchNone,
				})
				require.NotEmpty(t, response.Error)
				require.Empty(t, client.Actions(), "invalid GVK must not select a built-in object with the same kind")
			})
		}
	}
}
