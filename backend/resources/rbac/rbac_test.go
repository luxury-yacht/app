package rbac

import (
	"context"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/client-go/kubernetes"
)

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

// newManagerWithClient is a test helper for building a service with a fake client.
func newManagerWithClient(client kubernetes.Interface) *Service {
	return NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
			KubernetesClient: client,
		},
	})
}
